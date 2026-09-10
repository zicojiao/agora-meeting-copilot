import { createHash } from "node:crypto";
import type { EventBus } from "../../events.js";
import type { MeetingArtifactsService } from "../../meeting-artifacts-service.js";
import type { MeetingPublicationResult, MeetingPublisher } from "../../meeting-publisher.js";
import { COPILOT_NAME } from "../../product.js";
import type { Store } from "../../store/store.js";
import type { FeishuApi, FeishuPost, FeishuWikiNode } from "./feishu-client.js";

export type FeishuMeetingPublisherConfig = {
  wikiParentToken: string;
  targetChatId: string;
  tenantDomain: string;
  publicAppUrl: string;
};

type Logger = {
  info(bindings: Record<string, unknown>, message?: string): void;
  error(bindings: Record<string, unknown>, message?: string): void;
};

export class FeishuMeetingPublisher implements MeetingPublisher {
  private inFlight = new Map<string, Promise<MeetingPublicationResult | null>>();

  constructor(
    private config: FeishuMeetingPublisherConfig,
    private store: Store,
    private events: EventBus,
    private artifacts: MeetingArtifactsService,
    private api: FeishuApi,
    private logger: Logger,
    private now: () => Date = () => new Date()
  ) {}

  publish(roomId: string) {
    const existing = this.inFlight.get(roomId);
    if (existing) return existing;
    const operation = this.publishOnce(roomId).finally(() => this.inFlight.delete(roomId));
    this.inFlight.set(roomId, operation);
    return operation;
  }

  private async publishOnce(roomId: string) {
    const previous = await this.findCompletedPublication(roomId);
    if (previous) return previous;

    const createdNodes: FeishuWikiNode[] = [];
    try {
      const status = await this.artifacts.status(roomId);
      const notesMarkdown = await this.artifacts.notesMarkdown(roomId);
      const transcriptMarkdown = await this.artifacts.transcriptMarkdown(roomId);
      const participantNames = await this.listMeetingParticipantNames(roomId);
      const title = buildMeetingPageTitle(status.room.endedAt ?? status.room.updatedAt, status.finalNotes?.document?.title);
      const parent = await this.api.resolveWikiNode(this.config.wikiParentToken);

      const notesNode = await this.api.createWikiNode({
        spaceId: parent.spaceId,
        parentNodeToken: parent.nodeToken,
        title
      });
      createdNodes.push(notesNode);
      await this.api.writeMarkdown(notesNode.objectToken, prepareArtifactMarkdown(notesMarkdown, roomId));

      const transcriptNode = await this.api.createWikiNode({
        spaceId: parent.spaceId,
        parentNodeToken: notesNode.nodeToken,
        title: "Transcript"
      });
      createdNodes.push(transcriptNode);
      await this.api.writeMarkdown(transcriptNode.objectToken, prepareArtifactMarkdown(transcriptMarkdown, roomId));

      const notesUrl = wikiUrl(this.config.tenantDomain, notesNode.nodeToken);
      const transcriptUrl = wikiUrl(this.config.tenantDomain, transcriptNode.nodeToken);
      const publishedAt = this.now().toISOString();
      const message = await this.api.sendPost({
        chatId: this.config.targetChatId,
        post: buildGroupPost(
          title,
          roomId,
          participantNames,
          notesUrl,
          transcriptUrl,
          meetingSummaryUrl(this.config.publicAppUrl, roomId)
        ),
        uuid: deterministicMessageUuid(roomId)
      });
      const result: MeetingPublicationResult = {
        provider: "feishu",
        title,
        notesUrl,
        transcriptUrl,
        publishedAt
      };
      await this.events.publish(roomId, "meeting.publisher.completed", {
        ...result,
        notesNodeToken: notesNode.nodeToken,
        transcriptNodeToken: transcriptNode.nodeToken,
        messageId: message.messageId
      });
      this.logger.info({ roomId, provider: "feishu", notesNodeToken: notesNode.nodeToken, transcriptNodeToken: transcriptNode.nodeToken, messageId: message.messageId }, "Meeting artifacts published to Feishu");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const createdNodeTokens = createdNodes.map((node) => node.nodeToken);
      await this.events.publish(roomId, "meeting.publisher.failed", {
        provider: "feishu",
        error: message,
        createdNodeTokens,
        failedAt: this.now().toISOString()
      }).catch(() => undefined);
      this.logger.error({ roomId, provider: "feishu", error: message, createdNodeTokens }, "Meeting artifact publication failed");
      throw error;
    }
  }

  private async findCompletedPublication(roomId: string) {
    const completed = (await this.store.listEventsAfter(roomId, 0))
      .find((event) => event.type === "meeting.publisher.completed" && event.payload.provider === "feishu");
    if (!completed) return null;
    const { title, notesUrl, transcriptUrl, publishedAt } = completed.payload;
    if (![title, notesUrl, transcriptUrl, publishedAt].every((value) => typeof value === "string")) return null;
    return {
      provider: "feishu",
      title: title as string,
      notesUrl: notesUrl as string,
      transcriptUrl: transcriptUrl as string,
      publishedAt: publishedAt as string
    } satisfies MeetingPublicationResult;
  }

  private async listMeetingParticipantNames(roomId: string) {
    const [currentParticipants, events] = await Promise.all([
      this.store.listParticipants(roomId),
      this.store.listEventsAfter(roomId, 0)
    ]);
    const people = new Map<string, { name: string; isCopilot: boolean }>();
    const add = (displayName: unknown, role?: unknown) => {
      if (typeof displayName !== "string") return;
      const name = displayName.trim();
      if (!name) return;
      const key = name.toLocaleLowerCase();
      const isCopilot = role === "ai" || name.toLocaleLowerCase() === COPILOT_NAME.toLocaleLowerCase();
      const existing = people.get(key);
      if (!existing) people.set(key, { name, isCopilot });
      else if (isCopilot) existing.isCopilot = true;
    };

    for (const event of events) {
      if (event.type === "participant.joined" || event.type === "participant.left") {
        add(event.payload.displayName, event.payload.role);
      }
      if (event.type === "agent.status" && event.payload.agentUid === "900001") {
        add(COPILOT_NAME, "ai");
      }
    }
    for (const participant of currentParticipants) add(participant.displayName, participant.role);

    return [...people.values()]
      .sort((left, right) => Number(left.isCopilot) - Number(right.isCopilot))
      .map((person) => person.name);
  }
}

export function buildMeetingPageTitle(endedAt: string, rawTitle?: string) {
  const timestamp = new Date(endedAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(Number.isNaN(timestamp.getTime()) ? new Date(0) : timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("month")}${value("day")} ${value("hour")}:${value("minute")} UTC+8 · ${shortMeetingTitle(rawTitle)}`;
}

export function shortMeetingTitle(rawTitle?: string) {
  const normalized = (rawTitle ?? "")
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[|｜]+/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
  const source = normalized || "Meeting";
  let weight = 0;
  let output = "";
  for (const character of source) {
    const characterWeight = /\p{Script=Han}/u.test(character) ? 3 : 1;
    if (weight + characterWeight > 36) break;
    output += character;
    weight += characterWeight;
  }
  return output.trim() || "Meeting";
}

export function prepareArtifactMarkdown(markdown: string, roomId: string) {
  const withoutTitle = markdown.replace(/^#\s+[^\n]+\n+/, "").trim();
  return `- Room: \`${roomId}\`\n\n${withoutTitle}\n`;
}

export function deterministicMessageUuid(roomId: string) {
  const hash = createHash("sha256").update(`agora-meeting-copilot:feishu:${roomId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function wikiUrl(tenantDomain: string, nodeToken: string) {
  return `https://${tenantDomain}/wiki/${nodeToken}`;
}

export function meetingSummaryUrl(publicAppUrl: string, roomId: string) {
  const url = new URL("/summary", publicAppUrl);
  url.searchParams.set("room", roomId);
  return url.toString();
}

function buildGroupPost(
  title: string,
  roomId: string,
  participantNames: string[],
  notesUrl: string,
  transcriptUrl: string,
  summaryUrl: string
): FeishuPost {
  return {
    zh_cn: {
      title,
      content: [
        [{ tag: "text", text: "The meeting has ended. Notes and the full transcript are ready." }],
        [{ tag: "text", text: `Participants: ${participantNames.length ? participantNames.join(", ") : "None recorded"}` }],
        [{ tag: "a", text: "View meeting notes", href: notesUrl }],
        [{ tag: "a", text: "View full transcript", href: transcriptUrl }],
        [{ tag: "a", text: `Room: ${roomId}`, href: summaryUrl }]
      ]
    }
  };
}
