import { beforeEach, describe, expect, it } from "vitest";
import type { KanbanOperation, ParticipantRecord, RoomRecord } from "../src/domain.js";
import { EventBus } from "../src/events.js";
import { KanbanService } from "../src/kanban-service.js";
import { MemoryStore } from "../src/store/memory-store.js";

describe("KanbanService GPT Live functions", () => {
  let store: MemoryStore;
  let service: KanbanService;
  let host: ParticipantRecord;

  beforeEach(async () => {
    store = new MemoryStore();
    service = new KanbanService(store, new EventBus(store));
    const now = "2026-08-24T00:00:00.000Z";
    const room: RoomRecord = { id: "meet-board", status: "open", hostSecretHash: "hash", agentStatus: "standby", conversationMode: "standby", createdAt: now, updatedAt: now, expiresAt: "2026-08-25T00:00:00.000Z" };
    host = { roomId: room.id, rtcUid: "101", displayName: "Zico", role: "host", joinedAt: now, lastSeenAt: now };
    await store.createRoom(room);
    await store.upsertParticipant(host);
    await store.upsertParticipant({ roomId: room.id, rtcUid: "102", displayName: "Ada", role: "guest", joinedAt: now, lastSeenAt: now });
    await store.upsertParticipant({ roomId: room.id, rtcUid: "900001", displayName: "Copilot", role: "ai", joinedAt: now, lastSeenAt: now });
  });

  it("creates a card exactly once for one GPT Live call_id", async () => {
    const operation: KanbanOperation = { type: "create", title: "Ship launch checklist", assignee: "Ada", tags: ["Launch", "launch"] };
    const first = await service.executeGptLiveFunction(host.roomId, "call-create-1", operation);
    const duplicate = await service.executeGptLiveFunction(host.roomId, "call-create-1", operation);
    expect(first).toMatchObject({ ok: true, title: "Ship launch checklist", status: "backlog" });
    expect(duplicate).toEqual({ ok: true, duplicate: true, callId: "call-create-1" });
    expect(await store.listKanbanCards(host.roomId)).toMatchObject([{
      title: "Ship launch checklist", assignee: "Ada", tags: ["launch"], createdByUid: "900001", sourceTurnKey: "gpt-live:call-create-1"
    }]);
  });

  it("moves and updates cards using a natural-language card query", async () => {
    await service.executeGptLiveFunction(host.roomId, "call-create", { type: "create", title: "Confirm enterprise pricing" });
    await service.executeGptLiveFunction(host.roomId, "call-move", { type: "move", cardQuery: "enterprise pricing", status: "in_progress" });
    await service.executeGptLiveFunction(host.roomId, "call-update", { type: "update", cardQuery: "pricing", priority: "urgent", assignee: "Zico" });
    expect((await store.listKanbanCards(host.roomId))[0]).toMatchObject({ status: "in_progress", priority: "urgent", assignee: "Zico", version: 3 });
  });

  it("rejects an ambiguous card query without changing either card", async () => {
    await service.executeGptLiveFunction(host.roomId, "call-a", { type: "create", title: "Review launch pricing" });
    await service.executeGptLiveFunction(host.roomId, "call-b", { type: "create", title: "Review launch timeline" });
    await expect(service.executeGptLiveFunction(host.roomId, "call-c", { type: "move", cardQuery: "review launch", status: "done" })).rejects.toThrow("ambiguous");
    expect((await store.listKanbanCards(host.roomId)).map((card) => card.status)).toEqual(["backlog", "backlog"]);
  });

  it("requires the GPT Live participant to be present", async () => {
    await store.removeParticipant(host.roomId, "900001");
    await expect(service.executeGptLiveFunction(host.roomId, "call-missing", { type: "create", title: "Should not exist" })).rejects.toThrow("not present");
  });
});
