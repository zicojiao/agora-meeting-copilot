import { randomBytes, randomUUID } from "node:crypto";
import agoraToken from "agora-token";
import type { Config } from "./config.js";
import type { CopilotTurn, ParticipantRole, RoomRecord, RoomSnapshot } from "./domain.js";
import { normalizeCumulativeTranscript } from "./copilot-turns.js";
import { EventBus } from "./events.js";
import type { KanbanService } from "./kanban-service.js";
import type { MeetingNotesService } from "./meeting-notes-service.js";
import type { MeetingPublisher } from "./meeting-publisher.js";
import type { MeetingTranscriptionService } from "./meeting-transcription-service.js";
import { decideConversationMode } from "./policy.js";
import { COPILOT_NAME } from "./product.js";
import type { VoiceRuntimeAdapter } from "./runtime/voice-runtime.js";
import { createSecret, hashSecret, secretsMatch, signCapability } from "./security.js";
import type { Store } from "./store/store.js";

const { RtcRole, RtcTokenBuilder, RtmTokenBuilder } = agoraToken;
const IDLE_ROOM_GRACE_MS = 90_000;

export type JoinRoomResult = {
  capability: string;
  role: ParticipantRole;
  appId: string;
  channel: string;
  rtcUid: number;
  rtcToken: string;
  rtmToken: string;
  expiresAt: number;
};

export class RoomService {
  private startLocks = new Map<string, Promise<RoomRecord>>();
  private endLocks = new Map<string, Promise<RoomSnapshot>>();
  private focusTimers = new Map<string, NodeJS.Timeout>();
  private idleEndTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private config: Config,
    private store: Store,
    private events: EventBus,
    private runtime: VoiceRuntimeAdapter,
    private transcription: MeetingTranscriptionService,
    private notes: MeetingNotesService,
    private kanban: KanbanService,
    private publisher: MeetingPublisher
  ) {}

  async createRoom() {
    const now = new Date();
    const id = `meet-${randomBytes(5).toString("hex")}`;
    const hostSecret = createSecret();
    const room: RoomRecord = {
      id,
      status: "open",
      hostSecretHash: hashSecret(hostSecret),
      agentStatus: "offline",
      conversationMode: "standby",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.roomTtlMs).toISOString()
    };
    await this.store.createRoom(room);
    await this.events.publish(id, "room.created", { room: publicRoom(room) });
    return { roomId: id, hostSecret, guestUrl: `${this.config.PUBLIC_APP_URL}/?room=${encodeURIComponent(id)}` };
  }

  async joinRoom(roomId: string, displayName: string, hostSecret?: string): Promise<JoinRoomResult> {
    const room = await this.requireOpenRoom(roomId);
    this.clearIdleEndTimer(roomId);
    const role: ParticipantRole = hostSecret && secretsMatch(hostSecret, room.hostSecretHash) ? "host" : "guest";
    const participants = await this.store.listParticipants(roomId);
    let rtcUid: number;
    do rtcUid = Math.floor(100000 + Math.random() * 700000); while (participants.some((item) => item.rtcUid === String(rtcUid)) || rtcUid === 900001);
    const now = new Date().toISOString();
    await this.store.upsertParticipant({ roomId, rtcUid: String(rtcUid), displayName: cleanName(displayName), role, joinedAt: now, lastSeenAt: now });
    await this.touch(room);
    await this.events.publish(roomId, "participant.joined", { rtcUid: String(rtcUid), displayName: cleanName(displayName), role });

    const expiresIn = Math.min(60 * 60 * 6, Math.max(60, Math.floor((new Date(room.expiresAt).getTime() - Date.now()) / 1000)));
    const capability = signCapability({ roomId, rtcUid: String(rtcUid), displayName: cleanName(displayName), role, exp: Math.floor(Date.now() / 1000) + expiresIn }, this.config.CAPABILITY_SECRET);
    return {
      capability,
      role,
      appId: this.config.AGORA_APP_ID,
      channel: roomId,
      rtcUid,
      rtcToken: RtcTokenBuilder.buildTokenWithUid(this.config.AGORA_APP_ID, this.config.AGORA_APP_CERTIFICATE, roomId, rtcUid, RtcRole.PUBLISHER, expiresIn, expiresIn),
      rtmToken: RtmTokenBuilder.buildToken(this.config.AGORA_APP_ID, this.config.AGORA_APP_CERTIFICATE, String(rtcUid), expiresIn),
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn
    };
  }

  async leaveRoom(roomId: string, rtcUid: string) {
    const room = await this.requireRoom(roomId);
    const participants = await this.store.listParticipants(roomId);
    const participant = participants.find((item) => item.rtcUid === rtcUid);
    if (!participant) return { ok: true };
    await this.store.removeParticipant(roomId, rtcUid);
    await this.events.publish(roomId, "participant.left", {
      rtcUid,
      displayName: participant.displayName,
      role: participant.role
    });
    const remaining = participants.filter((item) => item.rtcUid !== rtcUid);
    if (room.status === "open" && participant.role !== "ai" && !remaining.some((item) => item.role !== "ai")) {
      this.scheduleIdleEnd(roomId);
    }
    return { ok: true };
  }

  async snapshot(roomId: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(roomId);
    return {
      room: publicRoom(room),
      participants: await this.store.listParticipants(roomId),
      transcription: await this.store.getLatestTranscriptionSession(roomId),
      transcriptSegments: await this.store.listMeetingTranscriptSegments(roomId),
      liveNotes: await this.notes.getLatest(roomId, "live"),
      finalNotes: await this.notes.getLatest(roomId, "final"),
      copilotTurns: await this.store.listCopilotTurns(roomId),
      kanbanCards: await this.store.listKanbanCards(roomId),
      kanbanActivities: await this.store.listKanbanActivities(roomId, 50)
    };
  }

  async issueRtcToken(roomId: string) {
    const room = await this.requireOpenRoom(roomId);
    const uid = Math.floor(1_000_000 + Math.random() * 8_000_000);
    const expiresIn = Math.min(60 * 60 * 6, Math.max(60, Math.floor((new Date(room.expiresAt).getTime() - Date.now()) / 1000)));
    return {
      appId: this.config.AGORA_APP_ID,
      channel: roomId,
      uid,
      token: RtcTokenBuilder.buildTokenWithUid(this.config.AGORA_APP_ID, this.config.AGORA_APP_CERTIFICATE, roomId, uid, RtcRole.PUBLISHER, expiresIn, expiresIn),
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn
    };
  }

  endMeeting(roomId: string) {
    const existing = this.endLocks.get(roomId);
    if (existing) return existing;
    const operation = this.doEndMeeting(roomId).finally(() => this.endLocks.delete(roomId));
    this.endLocks.set(roomId, operation);
    return operation;
  }

  private async doEndMeeting(roomId: string) {
    const room = await this.requireRoom(roomId);
    this.clearIdleEndTimer(roomId);
    if (room.status === "ended") {
      const snapshot = await this.snapshot(roomId);
      this.schedulePublication(roomId);
      return snapshot;
    }
    room.status = "ending";
    room.updatedAt = new Date().toISOString();
    await this.store.updateRoom(room);
    await this.events.publish(roomId, "meeting.ending", { room: publicRoom(room) });

    await this.transcription.stop(roomId).catch(async (error) => {
      await this.events.publish(roomId, "transcription.status", { status: "error", error: error instanceof Error ? error.message : String(error) });
    });
    await this.waitForTranscriptQuiet(roomId);
    const finalNotes = await this.notes.generateFinal(roomId);

    if (room.agentId) {
      await this.runtime.stop(roomId, room.agentId).catch(() => undefined);
      this.clearFocusTimer(roomId);
      room.agentId = undefined;
      room.agentStatus = "offline";
      room.conversationMode = "standby";
      room.focusUntil = undefined;
    }
    const endedAt = new Date();
    room.status = "ended";
    room.endedAt = endedAt.toISOString();
    room.updatedAt = room.endedAt;
    room.expiresAt = new Date(endedAt.getTime() + this.config.roomTtlMs).toISOString();
    await this.store.updateRoom(room);
    await this.events.publish(roomId, "meeting.ended", { room: publicRoom(room), finalNotes });
    const snapshot = await this.snapshot(roomId);
    this.schedulePublication(roomId);
    return snapshot;
  }

  private schedulePublication(roomId: string) {
    setImmediate(() => {
      void this.publisher.publish(roomId).catch(() => undefined);
    });
  }

  private async waitForTranscriptQuiet(roomId: string) {
    const deadline = Date.now() + 8_000;
    let lastSequence = (await this.store.listMeetingTranscriptSegments(roomId)).at(-1)?.sequence ?? 0;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      await delay(300);
      const sequence = (await this.store.listMeetingTranscriptSegments(roomId)).at(-1)?.sequence ?? 0;
      if (sequence !== lastSequence) {
        lastSequence = sequence;
        quietSince = Date.now();
      }
      if (Date.now() - quietSince >= 1_500) return;
    }
  }

  startAgent(roomId: string) {
    const existing = this.startLocks.get(roomId);
    if (existing) return existing;
    const operation = this.doStartAgent(roomId).finally(() => this.startLocks.delete(roomId));
    this.startLocks.set(roomId, operation);
    return operation;
  }

  private async doStartAgent(roomId: string) {
    const room = await this.requireOpenRoom(roomId);
    if (room.agentId && room.agentStatus !== "error" && room.agentStatus !== "offline") return room;
    room.agentStatus = "joining";
    room.lastError = undefined;
    await this.saveRoom(room, "agent.status", { status: room.agentStatus });
    try {
      const context = (await this.store.listCopilotTurns(roomId)).slice(-20).map((turn) => `${turn.speakerName}: ${turn.text}`).join("\n");
      const result = await this.runtime.start({ roomId, channel: roomId, remoteUids: ["*"], initialContext: context });
      room.agentId = result.agentId;
      room.agentStatus = "standby";
      room.conversationMode = "standby";
      const now = new Date().toISOString();
      await this.store.upsertParticipant({ roomId, rtcUid: "900001", displayName: COPILOT_NAME, role: "ai", joinedAt: now, lastSeenAt: now });
      await this.saveRoom(room, "agent.status", { status: room.agentStatus, agentUid: "900001" });
      return room;
    } catch (error) {
      room.agentStatus = "error";
      room.lastError = error instanceof Error ? error.message : String(error);
      await this.saveRoom(room, "agent.status", { status: room.agentStatus, error: room.lastError });
      throw error;
    }
  }

  async stopAgent(roomId: string) {
    const room = await this.requireRoom(roomId);
    await this.runtime.stop(roomId, room.agentId);
    this.clearFocusTimer(roomId);
    room.agentId = undefined;
    room.agentStatus = "offline";
    room.conversationMode = "standby";
    room.focusUntil = undefined;
    await this.store.removeParticipant(roomId, "900001");
    await this.events.publish(roomId, "participant.left", { rtcUid: "900001", displayName: COPILOT_NAME, role: "ai" });
    await this.saveRoom(room, "agent.status", { status: "offline" });
  }

  private scheduleIdleEnd(roomId: string) {
    this.clearIdleEndTimer(roomId);
    const timer = setTimeout(() => {
      this.idleEndTimers.delete(roomId);
      void this.finalizeIdleRoom(roomId);
    }, IDLE_ROOM_GRACE_MS);
    timer.unref();
    this.idleEndTimers.set(roomId, timer);
  }

  private async finalizeIdleRoom(roomId: string) {
    const room = await this.store.getRoom(roomId);
    if (!room || room.status !== "open") return;
    const participants = await this.store.listParticipants(roomId);
    if (participants.some((item) => item.role !== "ai")) return;
    await this.endMeeting(roomId).catch(() => undefined);
  }

  private clearIdleEndTimer(roomId: string) {
    const timer = this.idleEndTimers.get(roomId);
    if (timer) clearTimeout(timer);
    this.idleEndTimers.delete(roomId);
  }

  async ingestCopilotTurn(roomId: string, input: Omit<CopilotTurn, "id" | "roomId" | "createdAt"> & { createdAt?: string }) {
    const room = await this.requireOpenRoom(roomId);
    const participants = await this.store.listParticipants(roomId);
    const participant = participants.find((item) => item.rtcUid === input.speakerUid);
    const speakerName = input.role === "assistant" && input.speakerUid === "900001"
      ? COPILOT_NAME
      : participant?.displayName;
    if (!speakerName) throw Object.assign(new Error("Copilot turn speaker is not a known room participant"), { statusCode: 400 });
    const turn: CopilotTurn = {
      ...input,
      id: randomUUID(),
      roomId,
      text: input.role === "assistant"
        ? normalizeCumulativeTranscript(cleanText(input.text, 8000))
        : cleanText(input.text, 8000),
      speakerName,
      createdAt: input.createdAt ?? new Date().toISOString()
    };
    const accepted = await this.store.upsertCopilotTurn(turn);
    if (!accepted) return { accepted: false, turn };
    await this.touch(room);
    await this.events.publish(roomId, "copilot.turn.final", { turn });

    if (turn.role === "user") {
      if (room.agentStatus === "speaking") await this.runtime.interrupt(roomId).catch(() => undefined);
      const decision = decideConversationMode(turn.text, room.conversationMode);
      if (decision.stop) await this.closeFocus(room);
      else if (decision.extend && room.agentId) await this.openFocus(room);
    } else {
      await this.notes.handleTranscriptChanged(roomId);
      room.agentStatus = room.conversationMode;
      await this.saveRoom(room, "agent.status", { status: room.agentStatus });
    }
    return { accepted: true, turn };
  }

  async instructAgent(roomId: string, instruction: string) {
    const room = await this.requireOpenRoom(roomId);
    if (!room.agentId || room.agentStatus === "offline" || room.agentStatus === "error") {
      throw Object.assign(new Error("Copilot is not running in this room"), { statusCode: 409 });
    }
    await this.runtime.think(roomId, cleanText(instruction, 1_000));
    return { accepted: true };
  }

  private async openFocus(room: RoomRecord) {
    room.conversationMode = "focused";
    room.agentStatus = room.agentStatus === "thinking" || room.agentStatus === "speaking" ? room.agentStatus : "focused";
    room.focusUntil = new Date(Date.now() + 30_000).toISOString();
    await this.runtime.setConversationMode(room.id, "focused");
    await this.saveRoom(room, "agent.focus", { mode: "focused", focusUntil: room.focusUntil });
    this.clearFocusTimer(room.id);
    this.focusTimers.set(room.id, setTimeout(() => void this.closeFocusById(room.id), 30_100));
  }

  private async closeFocusById(roomId: string) {
    const room = await this.store.getRoom(roomId);
    if (room) await this.closeFocus(room);
  }

  private async closeFocus(room: RoomRecord) {
    this.clearFocusTimer(room.id);
    room.conversationMode = "standby";
    room.agentStatus = room.agentId ? "standby" : "offline";
    room.focusUntil = undefined;
    if (room.agentId) await this.runtime.setConversationMode(room.id, "standby").catch(() => undefined);
    await this.saveRoom(room, "agent.focus", { mode: "standby" });
  }

  private clearFocusTimer(roomId: string) {
    const timer = this.focusTimers.get(roomId);
    if (timer) clearTimeout(timer);
    this.focusTimers.delete(roomId);
  }

  private async touch(room: RoomRecord) {
    const now = new Date();
    room.updatedAt = now.toISOString();
    room.expiresAt = new Date(now.getTime() + this.config.roomTtlMs).toISOString();
    await this.store.updateRoom(room);
  }

  private async saveRoom(room: RoomRecord, eventType: string, payload: Record<string, unknown>) {
    await this.touch(room);
    await this.events.publish(room.id, eventType, payload);
  }

  private async requireRoom(roomId: string) {
    const room = await this.store.getRoom(roomId);
    if (!room) throw notFound("Meeting room not found");
    return room;
  }

  private async requireOpenRoom(roomId: string) {
    const room = await this.requireRoom(roomId);
    if (room.status !== "open" || room.expiresAt <= new Date().toISOString()) throw notFound("Meeting room has ended");
    return room;
  }

}

function publicRoom(room: RoomRecord): RoomSnapshot["room"] {
  const { hostSecretHash: _hostSecretHash, agentId: _agentId, ...safe } = room;
  return safe;
}

function cleanText(value: string, max: number) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function cleanName(value: string) {
  return cleanText(value, 60) || "Guest";
}

function notFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
