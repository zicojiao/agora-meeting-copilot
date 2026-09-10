import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import type { RoomRecord } from "../src/domain.js";
import { EventBus } from "../src/events.js";
import { KanbanService } from "../src/kanban-service.js";
import { createGptLiveProxyAccess, findFunctionCallPayload, findFunctionCallMetadata, GptLiveGateway, injectDelegation, joinSegmentedFunctionCall, unwrapResponseEvent, verifyGptLiveProxyAccess } from "../src/runtime/gpt-live-gateway.js";
import { parseGptLiveBoardFunction } from "../src/runtime/gpt-live-tools.js";
import { MemoryStore } from "../src/store/memory-store.js";

const config = loadConfig({
  NODE_ENV: "test",
  PORT: "8787",
  CAPABILITY_SECRET: "test-capability-secret-at-least-24",
  WEBHOOK_SECRET: "test-webhook-secret",
  AGORA_APP_ID: "a".repeat(32),
  AGORA_APP_CERTIFICATE: "b".repeat(32),
  OPENAI_API_KEY: "sk-test-key-long-enough-for-tests"
});

describe("GPT Live gateway protocol", () => {
  it("creates room-scoped credentials and rejects a mismatched bearer", () => {
    const access = createGptLiveProxyAccess(config, "meet-signed");
    const url = new URL(access.url);
    expect(verifyGptLiveProxyAccess(config, "meet-signed", Object.fromEntries(url.searchParams), `Bearer ${access.apiKey}`)).toEqual({ model: "gpt-live-1" });
    expect(verifyGptLiveProxyAccess(config, "meet-other", Object.fromEntries(url.searchParams), `Bearer ${access.apiKey}`)).toBeNull();
    expect(verifyGptLiveProxyAccess(config, "meet-signed", Object.fromEntries(url.searchParams), "Bearer wrong")).toBeNull();
  });

  it("injects Responses delegation and strict board tools into the session.start event", () => {
    const result = JSON.parse(injectDelegation(JSON.stringify({ type: "session.start", session: { model: "gpt-live-1", instructions: "Be concise." } }), "gpt-5.5"));
    expect(result.session.model).toBe("gpt-live-1");
    expect(result.session.instructions).toBe("Be concise.");
    expect(result.session.delegation).toMatchObject({ type: "responses", responses: { model: "gpt-5.5", tool_choice: "auto" } });
    expect(result.session.delegation.responses.tools.map((tool: { name: string }) => tool.name)).toContain("create_board_card");
    expect(result.session.delegation.responses.tools.every((tool: { parameters: { additionalProperties: boolean } }) => tool.parameters.additionalProperties === false)).toBe(true);
  });

  it("unwraps delegated Responses events", () => {
    const nested = { type: "response.output_item.done", item: { type: "function_call" } };
    expect(unwrapResponseEvent({ type: "response.event", event: nested })).toBe(nested);
    expect(unwrapResponseEvent(nested)).toBe(nested);
  });

  it("maps validated GPT Live arguments to typed Kanban operations", () => {
    expect(parseGptLiveBoardFunction("create_board_card", JSON.stringify({ title: "Prepare pilot", status: "in_progress", tags: ["pilot"] })))
      .toEqual({ type: "create", title: "Prepare pilot", status: "in_progress", tags: ["pilot"] });
    expect(parseGptLiveBoardFunction("create_board_card", JSON.stringify({ title: "Voice Canary", priority: "high", assignee: "", due_date: "", tags: ["pilot"] })))
      .toEqual({ type: "create", title: "Voice Canary", priority: "high", assignee: undefined, dueDate: undefined, tags: ["pilot"] });
    expect(parseGptLiveBoardFunction("move_board_card", JSON.stringify({ card_query: "prepare pilot", status: "done" })))
      .toEqual({ type: "move", cardId: undefined, cardQuery: "prepare pilot", status: "done" });
    expect(() => parseGptLiveBoardFunction("delete_board_card", "{}")).toThrow("Unsupported");
  });

  it("accepts flat and nested function-call events", () => {
    const documented = { call_id: "call-flat", name: "create_board_card", arguments: "{}" };
    expect(findFunctionCallPayload(documented)).toBe(documented);
    expect(findFunctionCallPayload({ type: "response.function_call_arguments.done", response: { output: [{ item: { call_id: "call-nested", name: "move_board_card", arguments: "{}" } }] } }))
      .toMatchObject({ call_id: "call-nested", name: "move_board_card" });
  });

  it("correlates function metadata with a later argument event by item_id", () => {
    const added = { type: "response.output_item.added", item: { id: "fc-live", type: "function_call", call_id: "call-live", name: "create_board_card", arguments: "" } };
    const metadata = findFunctionCallMetadata(added);
    expect(metadata).toEqual({ item_id: "fc-live", call_id: "call-live", name: "create_board_card" });
    expect(joinSegmentedFunctionCall(
      { type: "response.function_call_arguments.done", item_id: "fc-live", arguments: "{\"title\":\"Voice Canary\"}" },
      new Map([[metadata!.item_id, { call_id: metadata!.call_id, name: metadata!.name }]])
    )).toEqual({ call_id: "call-live", name: "create_board_card", arguments: "{\"title\":\"Voice Canary\"}" });
  });

  it("executes a function event and returns its result without blocking media forwarding", async () => {
    const store = new MemoryStore();
    const now = new Date().toISOString();
    const room: RoomRecord = { id: "meet-wire", status: "open", hostSecretHash: "hash", agentStatus: "standby", conversationMode: "standby", createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    await store.createRoom(room);
    await store.upsertParticipant({ roomId: room.id, rtcUid: "900001", displayName: "Copilot", role: "ai", joinedAt: now, lastSeenAt: now });
    const upstream = new FakeSocket();
    const downstream = new FakeSocket();
    let connection: { url: string; options: WebSocket.ClientOptions } | undefined;
    const gateway = new GptLiveGateway(config, new KanbanService(store, new EventBus(store)), quietLogger(), (url, options) => {
      connection = { url, options };
      return upstream as unknown as WebSocket;
    });
    const access = createGptLiveProxyAccess(config, room.id);
    const url = new URL(access.url);
    gateway.handle(downstream as unknown as WebSocket, room.id, Object.fromEntries(url.searchParams), `Bearer ${access.apiKey}`);
    expect(connection?.url).toBe("wss://api.openai.com/v1/live/sessions");
    expect(connection?.options.headers).toEqual({
      Authorization: expect.stringMatching(/^Bearer sk-/)
    });

    upstream.readyState = WebSocket.OPEN;
    upstream.emit("open");
    upstream.emit("message", Buffer.from(JSON.stringify({ type: "output_audio.delta", delta: "audio" })), false);
    upstream.emit("message", Buffer.from(JSON.stringify({
      type: "response.event",
      event: {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "fc-wire",
          type: "function_call",
          status: "completed",
          call_id: "call-wire",
          name: "create_board_card",
          arguments: JSON.stringify({ title: "Validate customer pilot", tags: ["pilot"] })
        }
      }
    })), false);

    await waitUntil(() => upstream.sent.some((message) => message.includes("response.item.create")));
    expect(downstream.sent).toContain(JSON.stringify({ type: "output_audio.delta", delta: "audio" }));
    const output = JSON.parse(upstream.sent.find((message) => message.includes("response.item.create"))!);
    expect(JSON.parse(output.item.output)).toMatchObject({ ok: true, title: "Validate customer pilot", status: "backlog" });
    expect(upstream.sent.map((message) => JSON.parse(message).type)).toContain("response.create");
    expect(await store.listKanbanCards(room.id)).toMatchObject([{ title: "Validate customer pilot", tags: ["pilot"] }]);

    downstream.emit("close");
    expect(upstream.sent.map((message) => JSON.parse(message).type)).toContain("session.close");
  });
});

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];
  send(data: unknown) { this.sent.push(data instanceof Buffer ? data.toString() : String(data)); }
  close() { this.readyState = WebSocket.CLOSED; }
}

function quietLogger() {
  return { error() {}, warn() {}, info() {} } as unknown as FastifyBaseLogger;
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for GPT Live function output");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
