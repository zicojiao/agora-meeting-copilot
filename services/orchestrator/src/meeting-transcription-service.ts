import { createHash, randomUUID } from "node:crypto";
import { COPILOT_RTC_UID } from "./canonical-transcript.js";
import type { Config } from "./config.js";
import type { MeetingTranscriptSegment, RoomRecord, TranscriptionSessionRecord } from "./domain.js";
import type { EventBus } from "./events.js";
import type { MeetingTranscriptionRuntime } from "./runtime/meeting-transcription-runtime.js";
import type { Store } from "./store/store.js";

export type MeetingTranscriptSegmentInput = {
  transcriptionSessionId: string;
  sourceSentenceId?: string | number;
  speakerUid: string;
  text: string;
  language?: string;
  startMs: number;
  durationMs: number;
  textTimestampMs?: number;
  speechStartMs?: number;
  createdAt?: string;
};

export class MeetingTranscriptionService {
  private startLocks = new Map<string, Promise<TranscriptionSessionRecord>>();
  private stopLocks = new Map<string, Promise<TranscriptionSessionRecord | null>>();

  constructor(
    private config: Config,
    private store: Store,
    private events: EventBus,
    private runtime: MeetingTranscriptionRuntime,
    private onAcceptedSegment?: (segment: MeetingTranscriptSegment) => void | Promise<void>
  ) {}

  start(roomId: string) {
    const existing = this.startLocks.get(roomId);
    if (existing) return existing;
    const operation = this.doStart(roomId).finally(() => this.startLocks.delete(roomId));
    this.startLocks.set(roomId, operation);
    return operation;
  }

  private async doStart(roomId: string) {
    const room = await this.requireOpenRoom(roomId);
    const existing = await this.store.getLatestTranscriptionSession(roomId);
    if (existing && (existing.status === "starting" || existing.status === "active")) return existing;

    const now = new Date().toISOString();
    const session: TranscriptionSessionRecord = {
      id: randomUUID(),
      roomId,
      provider: "agora-stt",
      status: "starting",
      subscriberUid: this.config.AGORA_STT_PUBLISHER_UID,
      publisherUid: this.config.AGORA_STT_PUBLISHER_UID,
      languages: this.config.agoraSttLanguages,
      createdAt: now,
      updatedAt: now
    };
    await this.store.createTranscriptionSession(session);
    await this.events.publish(roomId, "transcription.status", { transcription: session });

    try {
      const provider = await this.runtime.start({ roomId, channel: roomId });
      session.providerSessionId = provider.providerSessionId;
      session.status = provider.status;
      session.startedAt = new Date().toISOString();
      session.updatedAt = session.startedAt;
      await this.store.updateTranscriptionSession(session);
      await this.touch(room);
      await this.events.publish(roomId, "transcription.status", { transcription: session });
      return session;
    } catch (error) {
      session.status = "error";
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = new Date().toISOString();
      await this.store.updateTranscriptionSession(session);
      await this.events.publish(roomId, "transcription.status", { transcription: session });
      throw error;
    }
  }

  stop(roomId: string) {
    const existing = this.stopLocks.get(roomId);
    if (existing) return existing;
    const operation = this.doStop(roomId).finally(() => this.stopLocks.delete(roomId));
    this.stopLocks.set(roomId, operation);
    return operation;
  }

  private async doStop(roomId: string) {
    const session = await this.store.getLatestTranscriptionSession(roomId);
    if (!session || session.status === "stopped") return session;
    session.status = "stopping";
    session.updatedAt = new Date().toISOString();
    await this.store.updateTranscriptionSession(session);
    await this.events.publish(roomId, "transcription.status", { transcription: session });
    if (!session.providerSessionId) {
      session.status = "stopped";
    } else {
      try {
        const provider = await this.runtime.stop(session.providerSessionId);
        session.status = provider.status;
      } catch (error) {
        session.status = "error";
        session.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    session.stoppedAt = new Date().toISOString();
    session.updatedAt = session.stoppedAt;
    await this.store.updateTranscriptionSession(session);
    await this.events.publish(roomId, "transcription.status", { transcription: session });
    return session;
  }

  async reconcile(roomId: string) {
    const session = await this.store.getLatestTranscriptionSession(roomId);
    if (!session?.providerSessionId || session.status === "stopped") return session;
    try {
      const provider = await this.runtime.reconcile(session.providerSessionId);
      session.status = provider.status;
      session.lastError = undefined;
    } catch (error) {
      session.status = "error";
      session.lastError = error instanceof Error ? error.message : String(error);
    }
    session.updatedAt = new Date().toISOString();
    await this.store.updateTranscriptionSession(session);
    await this.events.publish(roomId, "transcription.status", { transcription: session });
    return session;
  }

  async ingestSegment(roomId: string, input: MeetingTranscriptSegmentInput) {
    const room = await this.requireAcceptingRoom(roomId);
    const session = await this.store.getLatestTranscriptionSession(roomId);
    if (!session || session.id !== input.transcriptionSessionId) throw badRequest("Transcript session is not current");
    if (!new Set(["starting", "active", "stopping"]).has(session.status)) throw badRequest("Transcript session is not accepting segments");

    const speakerUid = String(input.speakerUid);
    if (speakerUid === session.publisherUid || speakerUid === "900002") throw badRequest("System transcription UIDs cannot be speakers");
    if (speakerUid === COPILOT_RTC_UID) {
      return { accepted: false, ignored: "copilot_transcript_owned_by_gpt_live" as const };
    }
    const participants = await this.store.listParticipants(roomId);
    const participant = participants.find((item) => item.rtcUid === speakerUid);
    const speakerName = participant?.displayName || "";
    if (!speakerName) throw badRequest("Transcript speaker is not a known room participant");

    const text = cleanText(input.text, 12_000);
    if (!text) throw badRequest("Transcript segment is empty");
    const suppliedSentenceId = input.sourceSentenceId == null ? "" : String(input.sourceSentenceId).trim();
    const sourceSentenceId = suppliedSentenceId || fallbackSentenceId({
      speakerUid,
      textTimestampMs: input.textTimestampMs,
      speechStartMs: input.speechStartMs,
      startMs: input.startMs,
      durationMs: input.durationMs,
      text
    });
    const candidate: Omit<MeetingTranscriptSegment, "sequence"> = {
      id: randomUUID(),
      roomId,
      transcriptionSessionId: session.id,
      sourceSentenceId,
      identityQuality: suppliedSentenceId ? "source" : "fallback",
      speakerUid,
      speakerName,
      text,
      language: input.language ? cleanText(input.language, 32) : undefined,
      startMs: clampInteger(input.startMs, 0, Number.MAX_SAFE_INTEGER),
      durationMs: clampInteger(input.durationMs, 0, 3_600_000),
      textTimestampMs: optionalInteger(input.textTimestampMs),
      speechStartMs: optionalInteger(input.speechStartMs),
      createdAt: input.createdAt ?? new Date().toISOString()
    };
    const result = await this.store.upsertMeetingTranscriptSegment(candidate);
    if (result.accepted) {
      await this.touch(room);
      await this.events.publish(roomId, "transcript.segment.final", { segment: result.segment });
      await this.onAcceptedSegment?.(result.segment);
      if (result.segment.identityQuality === "fallback") {
        await this.events.publish(roomId, "transcription.quality", { code: "fallback_segment_identity", sequence: result.segment.sequence });
      }
    }
    return result;
  }

  getStatus(roomId: string) {
    return this.store.getLatestTranscriptionSession(roomId);
  }

  listTranscript(roomId: string) {
    return this.store.listMeetingTranscriptSegments(roomId);
  }

  private async requireOpenRoom(roomId: string) {
    const room = await this.requireRoom(roomId);
    if (room.status !== "open" || room.expiresAt <= new Date().toISOString()) throw notFound("Meeting room has ended");
    return room;
  }

  private async requireAcceptingRoom(roomId: string) {
    const room = await this.requireRoom(roomId);
    if (room.status === "ended") throw notFound("Meeting room has ended");
    return room;
  }

  private async requireRoom(roomId: string) {
    const room = await this.store.getRoom(roomId);
    if (!room) throw notFound("Meeting room not found");
    return room;
  }

  private async touch(room: RoomRecord) {
    const now = new Date();
    room.updatedAt = now.toISOString();
    room.expiresAt = new Date(now.getTime() + this.config.roomTtlMs).toISOString();
    await this.store.updateRoom(room);
  }
}

function fallbackSentenceId(input: { speakerUid: string; textTimestampMs?: number; speechStartMs?: number; startMs: number; durationMs: number; text: string }) {
  return `fallback-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function optionalInteger(value?: number) {
  return value == null ? undefined : clampInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function cleanText(value: string, max: number) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404 });
}
