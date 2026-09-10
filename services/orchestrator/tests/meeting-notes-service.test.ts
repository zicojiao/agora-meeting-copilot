import { describe, expect, it } from "vitest";
import { EventBus } from "../src/events.js";
import { MeetingNotesService } from "../src/meeting-notes-service.js";
import type { MeetingNotesDocument, MeetingNoteVersion } from "../src/domain.js";
import { MemoryStore } from "../src/store/memory-store.js";

const document: MeetingNotesDocument = {
  title: "Existing notes",
  overview: "The previous version of the notes.",
  topics: [],
  decisions: [],
  actionItems: [],
  openQuestions: [],
  keyPoints: [],
  sourceQuality: "good"
};

describe("MeetingNotesService", () => {
  it("keeps the previous document visible while a newer version is pending", async () => {
    const store = new MemoryStore();
    const service = new MeetingNotesService(store, new EventBus(store), {
      generate: async () => document
    });
    const completed: MeetingNoteVersion = {
      id: "live-1",
      roomId: "meet-devx",
      kind: "live",
      version: 1,
      status: "completed",
      sourceThroughSequence: 8,
      document,
      createdAt: "2026-07-12T03:00:00.000Z",
      updatedAt: "2026-07-12T03:01:00.000Z"
    };
    const pending: MeetingNoteVersion = {
      id: "live-2",
      roomId: "meet-devx",
      kind: "live",
      version: 2,
      status: "pending",
      sourceThroughSequence: 16,
      createdAt: "2026-07-12T03:15:00.000Z",
      updatedAt: "2026-07-12T03:15:00.000Z"
    };

    await store.createMeetingNoteVersion(completed);
    await store.createMeetingNoteVersion(pending);

    await expect(service.getLatest("meet-devx", "live")).resolves.toMatchObject({
      id: pending.id,
      status: "pending",
      document,
      updatedAt: completed.updatedAt
    });
  });
});
