import { describe, expect, it } from "vitest";
import type { CopilotTurn, RoomRecord } from "../src/domain.js";
import { MemoryStore } from "../src/store/memory-store.js";

describe("MemoryStore", () => {
  it("deduplicates transcripts and deletes expired room data", async () => {
    const store = new MemoryStore();
    const room: RoomRecord = { id: "meet-test", status: "open", hostSecretHash: "hash", agentStatus: "offline", conversationMode: "standby", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z" };
    const turn: CopilotTurn = { id: "one", roomId: room.id, agentTurnId: 1, turnSequence: 1, speakerUid: "100", speakerName: "Ada", role: "user", text: "hello", status: "final", createdAt: room.createdAt };
    await store.createRoom(room);
    expect(await store.upsertCopilotTurn(turn)).toBe(true);
    expect(await store.upsertCopilotTurn({ ...turn, id: "two" })).toBe(false);
    const assistant: CopilotTurn = { ...turn, id: "assistant-one", agentTurnId: 2, speakerUid: "900001", speakerName: "Copilot", role: "assistant", text: "Hi there" };
    expect(await store.upsertCopilotTurn(assistant)).toBe(true);
    expect(await store.upsertCopilotTurn({ ...assistant, id: "assistant-two", text: "Hi there! What's on your mind?" })).toBe(true);
    expect(await store.upsertCopilotTurn({ ...assistant, id: "assistant-late", turnSequence: 1, text: "Hi there!" })).toBe(false);
    expect(await store.upsertCopilotTurn({ ...assistant, id: "assistant-stream-two", turnSequence: 2, text: "Second sentence." })).toBe(true);
    expect((await store.listCopilotTurns(room.id)).filter((item) => item.role === "assistant")).toMatchObject([
      { id: "assistant-one", text: "Hi there! What's on your mind?" },
      { id: "assistant-stream-two", text: "Second sentence." }
    ]);
    expect(await store.deleteExpired("2026-01-03T00:00:00.000Z")).toBe(1);
    expect(await store.getRoom(room.id)).toBeNull();
    expect(await store.listCopilotTurns(room.id)).toEqual([]);
  });
});
