import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import WebSocket, { type Data } from "ws";
import type { Config } from "../config.js";
import type { KanbanService } from "../kanban-service.js";
import type { OpenAiKeyStore } from "../openai-key-store.js";
import { buildGptLiveDelegation, parseGptLiveBoardFunction } from "./gpt-live-tools.js";

export const GPT_LIVE_MODEL = "gpt-live-1";
const OPENAI_LIVE_URL = "wss://api.openai.com/v1/live/sessions";
const gracefulCloseTimeoutMs = 10_000;

export type GptLiveProxyAccess = { url: string; apiKey: string };
export type UpstreamFactory = (url: string, options: WebSocket.ClientOptions) => WebSocket;

export function createGptLiveProxyAccess(config: Config, roomId: string, model = GPT_LIVE_MODEL): GptLiveProxyAccess {
  const expires = Math.floor(Date.now() / 1_000) + Math.min(config.ROOM_TTL_HOURS * 3_600, 86_400);
  const signature = sign(config.CAPABILITY_SECRET, roomId, model, expires);
  const url = new URL(`${config.gptLiveProxyPublicUrl}/gpt-live/${encodeURIComponent(roomId)}`);
  url.searchParams.set("model", model);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return { url: url.toString(), apiKey: signature };
}

export function verifyGptLiveProxyAccess(config: Config, roomId: string, query: Record<string, unknown>, authorization?: string) {
  const model = typeof query.model === "string" ? query.model : "";
  const expires = Number(query.expires);
  const signature = typeof query.signature === "string" ? query.signature : "";
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!model || !Number.isInteger(expires) || expires < Math.floor(Date.now() / 1_000) || expires > Math.floor(Date.now() / 1_000) + 86_500) return null;
  const expected = sign(config.CAPABILITY_SECRET, roomId, model, expires);
  if (!safeEqual(signature, expected) || !safeEqual(bearer ?? "", expected)) return null;
  return { model };
}

export class GptLiveGateway {
  constructor(
    private config: Config,
    private kanban: KanbanService,
    private openAiKeys: OpenAiKeyStore,
    private log: FastifyBaseLogger,
    private upstreamFactory: UpstreamFactory = (url, options) => new WebSocket(url, options)
  ) {}

  handle(downstream: WebSocket, roomId: string, query: Record<string, unknown>, authorization?: string) {
    const access = verifyGptLiveProxyAccess(this.config, roomId, query, authorization);
    if (!access) {
      downstream.close(1008, "Invalid or expired GPT Live proxy credential");
      return;
    }

    let openAiApiKey: string;
    try {
      openAiApiKey = this.openAiKeys.require(roomId);
    } catch {
      downstream.close(1008, "GPT Live authorization is unavailable");
      return;
    }
    const upstream = this.upstreamFactory(OPENAI_LIVE_URL, {
      headers: { Authorization: `Bearer ${openAiApiKey}` }
    });
    const pending: Array<{ data: Data; isBinary: boolean }> = [];
    const functionCallsByItemId = new Map<string, { call_id: string; name: string }>();
    const handledCallIds = new Set<string>();
    let sessionCloseRequested = false;
    let gracefulCloseTimer: ReturnType<typeof setTimeout> | undefined;

    downstream.on("message", (data, isBinary) => {
      const downstreamEvent = isBinary ? null : parseEvent(data.toString());
      const outgoing = isBinary ? data : injectDelegation(data.toString(), this.config.OPENAI_GPT_LIVE_DELEGATION_MODEL);
      if (downstreamEvent?.type === "session.start") this.log.info({ roomId, model: access.model }, "Configured GPT Live Responses delegation");
      if (downstreamEvent?.type === "session.close") sessionCloseRequested = true;
      if (upstream.readyState === WebSocket.OPEN) upstream.send(outgoing, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data: outgoing, isBinary });
    });
    upstream.on("open", () => {
      for (const item of pending.splice(0)) upstream.send(item.data, { binary: item.isBinary });
    });
    upstream.on("message", (data, isBinary) => {
      if (!isBinary) {
        const event = parseEvent(data.toString());
        const responseEvent = event ? unwrapResponseEvent(event) : null;
        const metadata = responseEvent ? findFunctionCallMetadata(responseEvent) : null;
        if (metadata) functionCallsByItemId.set(metadata.item_id, { call_id: metadata.call_id, name: metadata.name });
        if (responseEvent?.type === "response.output_item.done" || responseEvent?.type === "response.function_call_arguments.done") {
          const call = findFunctionCallPayload(responseEvent) ?? joinSegmentedFunctionCall(responseEvent, functionCallsByItemId);
          const callId = typeof call?.call_id === "string" ? call.call_id : "";
          this.log.info({ roomId, callId, functionName: call?.name, eventType: responseEvent.type }, "Received GPT Live board function call");
          if (call && callId && !handledCallIds.has(callId)) {
            handledCallIds.add(callId);
            if (typeof responseEvent.item_id === "string") functionCallsByItemId.delete(responseEvent.item_id);
            void this.completeFunctionCall(upstream, roomId, call);
          }
          else if (!call) this.log.warn({ roomId, eventKeys: Object.keys(responseEvent) }, "GPT Live function call payload was not recognized");
          return;
        }
        if (event?.type === "error") {
          const error = asRecord(event.error);
          this.log.warn({ roomId, code: error?.code, param: error?.param, message: error?.message }, "GPT Live protocol error");
        } else if (event?.type === "session.started" || event?.type === "session.updated") {
          this.log.info({ roomId, eventType: event.type, hasDelegation: Boolean(asRecord(event.session)?.delegation) }, "GPT Live session configuration acknowledged");
        }
        if (typeof event?.type === "string" && (event.type === "response.event" || event.type.startsWith("response.") || event.type.startsWith("delegation."))) return;
      }
      if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: isBinary });
    });
    upstream.on("close", (code, reason) => {
      if (gracefulCloseTimer) clearTimeout(gracefulCloseTimer);
      this.log.info({ roomId, code, reason: reason.toString().slice(0, 120) }, "GPT Live upstream WebSocket closed");
      if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) downstream.close(code || 1011, reason.toString().slice(0, 120));
    });
    upstream.on("error", (error) => {
      this.log.error({ err: error, roomId }, "GPT Live upstream WebSocket failed");
      if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) downstream.close(1011, "GPT Live upstream failed");
    });
    downstream.on("close", () => {
      if (upstream.readyState === WebSocket.OPEN) {
        if (!sessionCloseRequested) {
          sessionCloseRequested = true;
          upstream.send(JSON.stringify({ type: "session.close", event_id: `close_${Date.now()}` }));
        }
        gracefulCloseTimer ??= setTimeout(() => {
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(1000, "GPT Live graceful close timed out");
        }, gracefulCloseTimeoutMs);
        gracefulCloseTimer.unref?.();
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        upstream.close(1000, "Downstream closed before GPT Live connected");
      }
    });
    downstream.on("error", (error) => this.log.warn({ err: error, roomId }, "GPT Live downstream WebSocket failed"));
  }

  private async completeFunctionCall(upstream: WebSocket, roomId: string, event: Record<string, unknown>) {
    const callId = typeof event.call_id === "string" ? event.call_id : "";
    const name = typeof event.name === "string" ? event.name : "";
    const args = typeof event.arguments === "string" ? event.arguments : "";
    let output: Record<string, unknown>;
    try {
      if (!callId) throw new Error("GPT Live function call is missing call_id");
      const operation = parseGptLiveBoardFunction(name, args);
      output = await this.kanban.executeGptLiveFunction(roomId, callId, operation);
    } catch (error) {
      output = { ok: false, error: error instanceof Error ? error.message : "The board action failed" };
      this.log.warn({ roomId, callId, functionName: name, err: error }, "GPT Live board function failed");
    }
    if (upstream.readyState !== WebSocket.OPEN || !callId) return;
    upstream.send(JSON.stringify({
      type: "response.item.create",
      event_id: `kanban_${callId}`,
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) }
    }));
    upstream.send(JSON.stringify({
      type: "response.create",
      event_id: `kanban_continue_${callId}`
    }));
  }
}

export function unwrapResponseEvent(event: Record<string, unknown>) {
  if (event.type !== "response.event") return event;
  return asRecord(event.event) ?? asRecord(event.response_event);
}

export function findFunctionCallPayload(event: Record<string, unknown>) {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: event, depth: 0 }];
  const visited = new Set<object>();
  while (queue.length) {
    const { value, depth } = queue.shift()!;
    if (!value || typeof value !== "object" || visited.has(value as object)) continue;
    visited.add(value as object);
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.call_id === "string" && typeof candidate.name === "string" && typeof candidate.arguments === "string") {
      return candidate;
    }
    if (depth >= 5) continue;
    for (const nested of Object.values(candidate)) {
      if (nested && typeof nested === "object") queue.push({ value: nested, depth: depth + 1 });
    }
  }
  return null;
}

export function findFunctionCallMetadata(event: Record<string, unknown>) {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: event, depth: 0 }];
  const visited = new Set<object>();
  while (queue.length) {
    const { value, depth } = queue.shift()!;
    if (!value || typeof value !== "object" || visited.has(value as object)) continue;
    visited.add(value as object);
    const candidate = value as Record<string, unknown>;
    const itemId = typeof candidate.item_id === "string" ? candidate.item_id : typeof candidate.id === "string" ? candidate.id : "";
    if (itemId && typeof candidate.call_id === "string" && typeof candidate.name === "string") {
      return { item_id: itemId, call_id: candidate.call_id, name: candidate.name };
    }
    if (depth >= 5) continue;
    for (const nested of Object.values(candidate)) {
      if (nested && typeof nested === "object") queue.push({ value: nested, depth: depth + 1 });
    }
  }
  return null;
}

export function joinSegmentedFunctionCall(event: Record<string, unknown>, metadataByItemId: Map<string, { call_id: string; name: string }>) {
  const itemId = typeof event.item_id === "string" ? event.item_id : "";
  const argumentsJson = typeof event.arguments === "string" ? event.arguments : "";
  const metadata = itemId ? metadataByItemId.get(itemId) : undefined;
  return metadata && argumentsJson ? { ...metadata, arguments: argumentsJson } : null;
}

export function injectDelegation(raw: string, delegationModel: string) {
  const event = parseEvent(raw);
  if (event?.type !== "session.start" || !event.session || typeof event.session !== "object") return raw;
  return JSON.stringify({ ...event, session: { ...(event.session as object), delegation: buildGptLiveDelegation(delegationModel) } });
}

function parseEvent(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch { return null; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sign(secret: string, roomId: string, model: string, expires: number) {
  return createHmac("sha256", secret).update(`${roomId}\n${model}\n${expires}`).digest("base64url");
}

function safeEqual(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
