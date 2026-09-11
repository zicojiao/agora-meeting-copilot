import { randomUUID } from "node:crypto";
import { buildCanonicalTranscriptSegments } from "./canonical-transcript.js";
import type { MeetingNoteKind, MeetingNoteVersion } from "./domain.js";
import type { EventBus } from "./events.js";
import type { MeetingNotesRuntime } from "./runtime/meeting-notes-runtime.js";
import type { Store } from "./store/store.js";

type RoomJob = {
  running: boolean;
  dirty: boolean;
  timer?: NodeJS.Timeout;
  promise?: Promise<MeetingNoteVersion>;
};

export class MeetingNotesService {
  private jobs = new Map<string, RoomJob>();

  constructor(
    private store: Store,
    private events: EventBus,
    private runtime: MeetingNotesRuntime
  ) {}

  async handleAcceptedSegment(roomId: string) {
    return this.handleTranscriptChanged(roomId);
  }

  async handleTranscriptChanged(roomId: string) {
    const job = this.job(roomId);
    job.dirty = true;
    if (job.running) return;
    const segments = await this.canonicalSegments(roomId);
    const latest = await this.store.getLatestMeetingNoteVersion(roomId, "live");
    const newSegmentCount = Math.max(0, segments.length - (latest?.sourceThroughSequence ?? 0));
    if (newSegmentCount >= 8) {
      this.clearTimer(job);
      void this.generateLive(roomId);
      return;
    }
    if (!job.timer) {
      job.timer = setTimeout(() => {
        job.timer = undefined;
        void this.generateLive(roomId);
      }, 60_000);
      job.timer.unref?.();
    }
  }

  generateLive(roomId: string) {
    const job = this.job(roomId);
    if (job.promise) {
      job.dirty = true;
      return job.promise;
    }
    job.running = true;
    job.dirty = false;
    this.clearTimer(job);
    const operation = this.generateVersion(roomId, "live").finally(() => {
      job.running = false;
      job.promise = undefined;
      if (job.dirty) {
        job.dirty = false;
        void this.generateLive(roomId);
      }
    });
    job.promise = operation;
    return operation;
  }

  async generateFinal(roomId: string) {
    const job = this.job(roomId);
    this.clearTimer(job);
    job.dirty = false;
    await job.promise?.catch(() => undefined);
    return this.generateVersion(roomId, "final");
  }

  async getLatest(roomId: string, kind: MeetingNoteKind) {
    const versions = await this.store.listMeetingNoteVersions(roomId, kind);
    const latest = versions[0] ?? null;
    if (!latest || latest.document || latest.status === "completed") return latest;
    const previousVisible = versions.find((version) => version.document);
    if (!previousVisible?.document) return latest;
    return {
      ...latest,
      document: previousVisible.document,
      updatedAt: previousVisible.updatedAt
    };
  }

  private async generateVersion(roomId: string, kind: MeetingNoteKind): Promise<MeetingNoteVersion> {
    const segments = await this.canonicalSegments(roomId);
    const latest = await this.store.getLatestMeetingNoteVersion(roomId, kind);
    const through = segments.length;
    const now = new Date().toISOString();
    const version: MeetingNoteVersion = {
      id: randomUUID(),
      roomId,
      kind,
      version: (latest?.version ?? 0) + 1,
      status: "pending",
      sourceThroughSequence: through,
      createdAt: now,
      updatedAt: now
    };
    await this.store.createMeetingNoteVersion(version);
    await this.events.publish(roomId, `notes.${kind}.status`, { notes: await this.getLatest(roomId, kind) ?? version });

    try {
      version.document = await this.runtime.generate(roomId, kind, segments);
      version.status = "completed";
      version.updatedAt = new Date().toISOString();
      await this.store.updateMeetingNoteVersion(version);
      await this.events.publish(roomId, `notes.${kind}.completed`, { notes: version });
    } catch (error) {
      version.status = "failed";
      version.error = safeNotesError(error);
      version.updatedAt = new Date().toISOString();
      await this.store.updateMeetingNoteVersion(version);
      await this.events.publish(roomId, `notes.${kind}.status`, { notes: await this.getLatest(roomId, kind) ?? version });
    }
    return version;
  }

  private async canonicalSegments(roomId: string) {
    const [room, segments, copilotTurns] = await Promise.all([
      this.store.getRoom(roomId),
      this.store.listMeetingTranscriptSegments(roomId),
      this.store.listCopilotTurns(roomId)
    ]);
    if (!room) throw Object.assign(new Error("Meeting room not found"), { statusCode: 404 });
    return buildCanonicalTranscriptSegments(room, segments, copilotTurns);
  }

  private job(roomId: string) {
    const job = this.jobs.get(roomId) ?? { running: false, dirty: false };
    this.jobs.set(roomId, job);
    return job;
  }

  private clearTimer(job: RoomJob) {
    if (job.timer) clearTimeout(job.timer);
    job.timer = undefined;
  }
}

function safeNotesError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/OpenAI API key is required/i.test(message)) return "Invite the AI teammate with an OpenAI API key to enable AI notes";
  return "AI notes could not be generated";
}
