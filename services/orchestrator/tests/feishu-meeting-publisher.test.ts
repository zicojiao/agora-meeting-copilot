import { beforeEach, describe, expect, it } from "vitest";
import type { MeetingNotesDocument, RoomRecord } from "../src/domain.js";
import { EventBus } from "../src/events.js";
import type { FeishuApi, FeishuPost, FeishuWikiNode } from "../src/internal/feishu/feishu-client.js";
import {
  buildMeetingPageTitle,
  deterministicMessageUuid,
  FeishuMeetingPublisher,
  meetingSummaryUrl,
  shortMeetingTitle
} from "../src/internal/feishu/feishu-meeting-publisher.js";
import { MeetingArtifactsService } from "../src/meeting-artifacts-service.js";
import { MemoryStore } from "../src/store/memory-store.js";

const roomId = "meet-a7ec";
const endedAt = "2026-07-13T06:52:00.000Z";
const notesDocument: MeetingNotesDocument = {
  title: "Copilot voice test",
  overview: "The team validated Copilot's voice response.",
  topics: ["Voice testing"],
  decisions: [],
  actionItems: [],
  openQuestions: [],
  keyPoints: [],
  sourceQuality: "good"
};

describe("FeishuMeetingPublisher", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await seedEndedMeeting(store);
  });

  it("publishes notes as the meeting page, Transcript as its child, and one group message", async () => {
    const api = new FakeFeishuApi();
    const events = new EventBus(store);
    const publisher = new FeishuMeetingPublisher(
      {
        wikiParentToken: "wiki-parent",
        targetChatId: "oc_devx",
        tenantDomain: "devx.feishu.cn",
        publicAppUrl: "https://agora-meeting-copilot.vercel.app"
      },
      store,
      events,
      new MeetingArtifactsService(store),
      api,
      logger,
      () => new Date("2026-07-13T07:00:00.000Z")
    );

    const first = await publisher.publish(roomId);
    const second = await publisher.publish(roomId);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      provider: "feishu",
      title: "0713 14:52 UTC+8 · Copilot voice test",
      notesUrl: "https://devx.feishu.cn/wiki/notes-node",
      transcriptUrl: "https://devx.feishu.cn/wiki/transcript-node"
    });
    expect(api.created).toEqual([
      { spaceId: "space-1", parentNodeToken: "wiki-parent", title: "0713 14:52 UTC+8 · Copilot voice test" },
      { spaceId: "space-1", parentNodeToken: "notes-node", title: "Transcript" }
    ]);
    expect(api.writes[0]).toMatchObject({ documentToken: "notes-doc" });
    expect(api.writes[0]?.markdown).toContain(`Room: \`${roomId}\``);
    expect(api.writes[0]?.markdown).toContain("The team validated Copilot's voice response.");
    expect(api.writes[0]?.markdown).not.toMatch(/^# /);
    expect(api.writes[1]).toMatchObject({ documentToken: "transcript-doc" });
    expect(api.writes[1]?.markdown).toContain("Zico");
    expect(api.messages).toHaveLength(1);
    expect(api.messages[0]).toMatchObject({ chatId: "oc_devx", uuid: deterministicMessageUuid(roomId) });
    expect(api.messages[0]?.post.zh_cn.content).toEqual([
      [{ tag: "text", text: "The meeting has ended. Notes and the full transcript are ready." }],
      [{ tag: "text", text: "Participants: Zico, Ada, Copilot" }],
      [{ tag: "a", text: "View meeting notes", href: "https://devx.feishu.cn/wiki/notes-node" }],
      [{ tag: "a", text: "View full transcript", href: "https://devx.feishu.cn/wiki/transcript-node" }],
      [{
        tag: "a",
        text: `Room: ${roomId}`,
        href: `https://agora-meeting-copilot.vercel.app/summary?room=${roomId}`
      }]
    ]);
    expect((await store.listEventsAfter(roomId, 0)).filter((event) => event.type === "meeting.publisher.completed")).toHaveLength(1);
  });

  it("records a failed publication without marking it completed", async () => {
    const api = new FakeFeishuApi();
    api.failure = new Error("Wiki unavailable");
    const publisher = new FeishuMeetingPublisher(
      {
        wikiParentToken: "wiki-parent",
        targetChatId: "oc_devx",
        tenantDomain: "devx.feishu.cn",
        publicAppUrl: "https://agora-meeting-copilot.vercel.app"
      },
      store,
      new EventBus(store),
      new MeetingArtifactsService(store),
      api,
      logger
    );

    await expect(publisher.publish(roomId)).rejects.toThrow("Wiki unavailable");
    const events = await store.listEventsAfter(roomId, 0);
    expect(events.some((event) => event.type === "meeting.publisher.failed")).toBe(true);
    expect(events.some((event) => event.type === "meeting.publisher.completed")).toBe(false);
  });

  it("formats a compact Shanghai-local meeting title", () => {
    expect(buildMeetingPageTitle(endedAt, "  Copilot\nvoice test  ")).toBe("0713 14:52 UTC+8 · Copilot voice test");
    expect(shortMeetingTitle("This is a very long meeting title that should be truncated")).toBe("This is a very long meeting title th");
    expect(shortMeetingTitle("   ")).toBe("Meeting");
    expect(meetingSummaryUrl("https://agora-meeting-copilot.vercel.app/", roomId)).toBe(
      `https://agora-meeting-copilot.vercel.app/summary?room=${roomId}`
    );
  });
});

class FakeFeishuApi implements FeishuApi {
  created: Array<{ spaceId: string; parentNodeToken: string; title: string }> = [];
  writes: Array<{ documentToken: string; markdown: string }> = [];
  messages: Array<{ chatId: string; post: FeishuPost; uuid: string }> = [];
  failure?: Error;

  async resolveWikiNode(): Promise<FeishuWikiNode> {
    if (this.failure) throw this.failure;
    return node("wiki-parent", "parent-doc", "Meeting Copilot");
  }

  async createWikiNode(input: { spaceId: string; parentNodeToken: string; title: string }) {
    if (this.failure) throw this.failure;
    this.created.push(input);
    return input.title === "Transcript"
      ? node("transcript-node", "transcript-doc", input.title)
      : node("notes-node", "notes-doc", input.title);
  }

  async writeMarkdown(documentToken: string, markdown: string) {
    if (this.failure) throw this.failure;
    this.writes.push({ documentToken, markdown });
  }

  async sendPost(input: { chatId: string; post: FeishuPost; uuid: string }) {
    if (this.failure) throw this.failure;
    this.messages.push(input);
    return { messageId: "message-1", chatId: input.chatId, createTime: "1" };
  }
}

const logger = {
  info: () => undefined,
  error: () => undefined
};

function node(nodeToken: string, objectToken: string, title: string): FeishuWikiNode {
  return { spaceId: "space-1", nodeToken, objectToken, objectType: "docx", title };
}

async function seedEndedMeeting(store: MemoryStore) {
  const room: RoomRecord = {
    id: roomId,
    status: "ended",
    hostSecretHash: "hash",
    agentStatus: "offline",
    conversationMode: "standby",
    createdAt: "2026-07-13T06:30:00.000Z",
    updatedAt: endedAt,
    endedAt,
    expiresAt: "2099-07-14T06:52:00.000Z"
  };
  await store.createRoom(room);
  await store.appendEvent(roomId, "participant.joined", { rtcUid: "100", displayName: "Zico", role: "host" });
  await store.appendEvent(roomId, "participant.joined", { rtcUid: "200", displayName: "Ada", role: "guest" });
  await store.appendEvent(roomId, "participant.left", { rtcUid: "200", displayName: "Ada", role: "guest" });
  await store.appendEvent(roomId, "participant.joined", { rtcUid: "101", displayName: "zico", role: "guest" });
  await store.appendEvent(roomId, "agent.status", { status: "standby", agentUid: "900001" });
  await store.upsertParticipant({
    roomId,
    rtcUid: "100",
    displayName: "Zico",
    role: "host",
    joinedAt: room.createdAt,
    lastSeenAt: endedAt
  });
  await store.upsertParticipant({
    roomId,
    rtcUid: "900001",
    displayName: "Copilot",
    role: "ai",
    joinedAt: room.createdAt,
    lastSeenAt: endedAt
  });
  await store.createMeetingNoteVersion({
    id: "notes-final",
    roomId,
    kind: "final",
    version: 1,
    status: "completed",
    sourceThroughSequence: 1,
    document: notesDocument,
    createdAt: endedAt,
    updatedAt: endedAt
  });
  await store.upsertMeetingTranscriptSegment({
    id: "segment-1",
    roomId,
    transcriptionSessionId: "session-1",
    sourceSentenceId: "sentence-1",
    identityQuality: "source",
    speakerUid: "100",
    speakerName: "Zico",
    text: "Please test meeting publication.",
    language: "en-US",
    startMs: 1000,
    durationMs: 800,
    createdAt: "2026-07-13T06:30:01.000Z"
  });
}
