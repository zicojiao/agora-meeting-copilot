import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Capability, CopilotTurn } from "./domain.js";
import { EventBus } from "./events.js";
import { KanbanService } from "./kanban-service.js";
import { MeetingArtifactsService } from "./meeting-artifacts-service.js";
import { MeetingNotesService } from "./meeting-notes-service.js";
import type { MeetingPublisher } from "./meeting-publisher.js";
import { MeetingTranscriptionService } from "./meeting-transcription-service.js";
import { OpenAiKeyStore } from "./openai-key-store.js";
import { createInternalMeetingPublisher } from "./internal/feishu/create-internal-meeting-publisher.js";
import { RoomService } from "./room-service.js";
import { AgoraConvoAiRuntimeAdapter } from "./runtime/agora-convo-ai-runtime.js";
import { AgoraSttRuntime, type MeetingTranscriptionRuntime } from "./runtime/meeting-transcription-runtime.js";
import { OpenAIMeetingNotesRuntime, type MeetingNotesRuntime } from "./runtime/meeting-notes-runtime.js";
import { GptLiveGateway, type UpstreamFactory } from "./runtime/gpt-live-gateway.js";
import type { VoiceRuntimeAdapter } from "./runtime/voice-runtime.js";
import { bearerToken, verifyCapability } from "./security.js";
import { createStore } from "./store/create-store.js";
import type { Store } from "./store/store.js";

const joinSchema = z.object({ displayName: z.string().trim().min(1).max(60), hostSecret: z.string().optional() });
const copilotTurnSchema = z.object({
  agentTurnId: z.number().int().nonnegative(),
  turnSequence: z.number().int().nonnegative(),
  speakerUid: z.string().min(1).max(64),
  speakerName: z.string().min(1).max(60),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(8000),
  language: z.string().max(32).optional(),
  status: z.enum(["final", "interrupted"]).default("final"),
  createdAt: z.string().datetime().optional()
});
const agentInstructionSchema = z.object({ instruction: z.string().trim().min(1).max(1_000) });
const agentStartSchema = z.object({ openAiApiKey: z.string().trim().min(20).max(512).optional() }).default({});

const transcriptSegmentSchema = z.object({
  transcriptionSessionId: z.string().uuid(),
  sourceSentenceId: z.union([z.string().max(128), z.number().int().nonnegative()]).optional(),
  speakerUid: z.string().min(1).max(64),
  text: z.string().min(1).max(12_000),
  language: z.string().max(32).optional(),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  textTimestampMs: z.number().nonnegative().optional(),
  speechStartMs: z.number().nonnegative().optional(),
  createdAt: z.string().datetime().optional()
});

const kanbanStatusSchema = z.enum(["backlog", "in_progress", "blocked", "done"]);
const kanbanPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const kanbanCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().max(1_000).optional(),
  status: kanbanStatusSchema.optional(),
  priority: kanbanPrioritySchema.optional(),
  assigneeUid: z.string().max(64).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(6).optional()
});
const kanbanUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(1_000).optional(),
  status: kanbanStatusSchema.optional(),
  priority: kanbanPrioritySchema.optional(),
  assigneeUid: z.string().max(64).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(6).optional(),
  position: z.number().finite().optional()
});

export type AppDependencies = { store?: Store; runtime?: VoiceRuntimeAdapter; transcriptionRuntime?: MeetingTranscriptionRuntime; notesRuntime?: MeetingNotesRuntime; openAiKeys?: OpenAiKeyStore; gptLiveUpstreamFactory?: UpstreamFactory; publisher?: MeetingPublisher };

export async function buildApp(config: Config, dependencies: AppDependencies = {}) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : {
      redact: ["req.headers.authorization", "req.body.hostSecret", "req.body.openAiApiKey", "req.body.text", "req.body.query"],
      serializers: { req: requestForLog }
    },
    bodyLimit: 64 * 1024,
    trustProxy: true
  });
  await app.register(websocket);
  await app.register(cors, {
    credentials: false,
    origin(origin, callback) {
      callback(null, !origin || config.allowedOrigins.includes(origin));
    }
  });

  const store = dependencies.store ?? createStore(config);
  await store.init();
  const events = new EventBus(store);
  const openAiKeys = dependencies.openAiKeys ?? new OpenAiKeyStore(config);
  const runtime = dependencies.runtime ?? new AgoraConvoAiRuntimeAdapter(config);
  const transcriptionRuntime = dependencies.transcriptionRuntime ?? new AgoraSttRuntime(config);
  const notesRuntime = dependencies.notesRuntime ?? new OpenAIMeetingNotesRuntime(config, openAiKeys);
  const notes = new MeetingNotesService(store, events, notesRuntime);
  const kanban = new KanbanService(store, events);
  const gptLiveGateway = new GptLiveGateway(config, kanban, openAiKeys, app.log, dependencies.gptLiveUpstreamFactory);
  const transcription = new MeetingTranscriptionService(config, store, events, transcriptionRuntime, (segment) => notes.handleAcceptedSegment(segment.roomId));
  const artifacts = new MeetingArtifactsService(store);
  const publisher = dependencies.publisher ?? createInternalMeetingPublisher(config, store, events, artifacts, app.log);
  const rooms = new RoomService(config, store, events, runtime, transcription, notes, kanban, publisher, openAiKeys);
  app.addHook("onClose", async () => openAiKeys.clear());

  app.get("/healthz", async () => ({ ok: true, service: "agora-meeting-copilot-orchestrator" }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await store.listActiveRooms();
      return {
        ready: true,
        storage: config.STORAGE_DRIVER,
        voiceRuntime: "openai-gpt-live-1",
        openAiKeyMode: config.OPENAI_KEY_MODE,
        kanbanCommands: "gpt-live-function-calling",
        transcription: config.agoraSttEnabled ? "configured" : "stt_not_configured",
        meetingPublisher: config.feishu ? "feishu" : "disabled"
      };
    } catch {
      return reply.code(503).send({ ready: false, reason: "storage_unavailable" });
    }
  });

  app.post("/rooms", async (_request, reply) => reply.code(201).send(await rooms.createRoom()));

  app.get<{ Params: { roomId: string }; Querystring: Record<string, string> }>("/gpt-live/:roomId", { websocket: true }, (socket, request) => {
    gptLiveGateway.handle(socket, request.params.roomId, request.query, request.headers.authorization);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/participants", async (request, reply) => {
    const body = joinSchema.parse(request.body);
    return reply.code(201).send(await rooms.joinRoom(request.params.roomId, body.displayName, body.hostSecret));
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/participants/leave", async (request, reply) => {
    const capability = authorize(request, config, request.params.roomId);
    return reply.code(202).send(await rooms.leaveRoom(request.params.roomId, capability.rtcUid));
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId", async (request) => {
    authorize(request, config, request.params.roomId);
    return rooms.snapshot(request.params.roomId);
  });

  app.get<{ Params: { roomId: string }; Querystring: { capability?: string; after?: string } }>("/rooms/:roomId/events", async (request, reply) => {
    authorize(request, config, request.params.roomId, request.query.capability);
    const after = Number(request.headers["last-event-id"] ?? request.query.after ?? 0) || 0;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": request.headers.origin && config.allowedOrigins.includes(request.headers.origin) ? request.headers.origin : config.allowedOrigins[0]
    });
    for (const event of await store.listEventsAfter(request.params.roomId, after)) writeSse(reply.raw, event);
    const unsubscribe = events.subscribe(request.params.roomId, (event) => writeSse(reply.raw, event));
    const heartbeat = setInterval(() => reply.raw.write(": keepalive\n\n"), 15_000);
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/memory", async (request) => {
    authorize(request, config, request.params.roomId);
    return rooms.snapshot(request.params.roomId);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/media-token", async (request) => {
    authorize(request, config, request.params.roomId);
    return rooms.issueRtcToken(request.params.roomId);
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/transcription/start", async (request, reply) => {
    authorize(request, config, request.params.roomId);
    return reply.code(202).send({ transcription: await transcription.start(request.params.roomId) });
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/transcription", async (request) => {
    authorize(request, config, request.params.roomId);
    return { transcription: await transcription.getStatus(request.params.roomId) };
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/transcript-segments", async (request, reply) => {
    authorize(request, config, request.params.roomId);
    const body = transcriptSegmentSchema.parse(request.body);
    return reply.code(202).send(await transcription.ingestSegment(request.params.roomId, body));
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/transcript", async (request) => {
    authorize(request, config, request.params.roomId);
    return { segments: await transcription.listTranscript(request.params.roomId) };
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/notes", async (request) => {
    authorize(request, config, request.params.roomId);
    return {
      liveNotes: await notes.getLatest(request.params.roomId, "live"),
      finalNotes: await notes.getLatest(request.params.roomId, "final")
    };
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/kanban/cards", async (request, reply) => {
    const capability = authorize(request, config, request.params.roomId);
    const card = await kanban.createManualCard(request.params.roomId, capability.rtcUid, kanbanCreateSchema.parse(request.body));
    return reply.code(201).send({ card });
  });

  app.patch<{ Params: { roomId: string; cardId: string } }>("/rooms/:roomId/kanban/cards/:cardId", async (request) => {
    const capability = authorize(request, config, request.params.roomId);
    const card = await kanban.updateManualCard(request.params.roomId, capability.rtcUid, request.params.cardId, kanbanUpdateSchema.parse(request.body));
    return { card };
  });

  app.delete<{ Params: { roomId: string; cardId: string } }>("/rooms/:roomId/kanban/cards/:cardId", async (request, reply) => {
    const capability = authorize(request, config, request.params.roomId);
    await kanban.deleteManualCard(request.params.roomId, capability.rtcUid, request.params.cardId);
    return reply.code(204).send();
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/end", async (request, reply) => {
    requireHost(authorize(request, config, request.params.roomId));
    return reply.code(202).send(await rooms.endMeeting(request.params.roomId));
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/artifacts/status", async (request) => {
    return artifacts.status(request.params.roomId);
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/artifacts/transcript.md", async (request, reply) => {
    const markdown = await artifacts.transcriptMarkdown(request.params.roomId);
    return reply.type("text/markdown; charset=utf-8").header("content-disposition", "attachment; filename=meeting-transcript.md").send(markdown);
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/artifacts/notes.md", async (request, reply) => {
    const markdown = await artifacts.notesMarkdown(request.params.roomId);
    return reply.type("text/markdown; charset=utf-8").header("content-disposition", "attachment; filename=meeting-notes.md").send(markdown);
  });

  app.get<{ Params: { roomId: string } }>("/rooms/:roomId/artifacts/all.zip", async (request, reply) => {
    const archive = await artifacts.zip(request.params.roomId);
    return reply.type("application/zip").header("content-disposition", "attachment; filename=meeting-artifacts.zip").send(archive);
  });

  const ingestCopilotTurn = async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
    const capability = authorize(request, config, request.params.roomId);
    const body = copilotTurnSchema.parse(request.body);
    if (body.role === "user" && body.speakerUid !== capability.rtcUid) {
      throw Object.assign(new Error("A participant can submit only their own voice turn"), { statusCode: 403 });
    }
    if (body.role === "assistant" && body.speakerUid !== "900001") {
      throw Object.assign(new Error("Assistant turns must belong to the Copilot participant"), { statusCode: 400 });
    }
    return reply.code(202).send(await rooms.ingestCopilotTurn(request.params.roomId, body as Omit<CopilotTurn, "id" | "roomId" | "createdAt"> & { createdAt?: string }));
  };

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/copilot/turns", ingestCopilotTurn);
  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/transcripts", ingestCopilotTurn);

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent/start", async (request, reply) => {
    requireHost(authorize(request, config, request.params.roomId));
    const { openAiApiKey } = agentStartSchema.parse(request.body);
    const room = await rooms.startAgent(request.params.roomId, openAiApiKey);
    return reply.code(202).send({ status: room.agentStatus });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent/stop", async (request, reply) => {
    requireHost(authorize(request, config, request.params.roomId));
    await rooms.stopAgent(request.params.roomId);
    return reply.code(202).send({ ok: true });
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent/interrupt", async (request, reply) => {
    requireHost(authorize(request, config, request.params.roomId));
    return reply.code(202).send(await rooms.interruptAgent(request.params.roomId));
  });

  app.post<{ Params: { roomId: string } }>("/rooms/:roomId/agent/think", async (request, reply) => {
    requireHost(authorize(request, config, request.params.roomId));
    const { instruction } = agentInstructionSchema.parse(request.body);
    return reply.code(202).send(await rooms.instructAgent(request.params.roomId, instruction));
  });

  app.post("/webhooks/agora", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${config.WEBHOOK_SECRET}`) return reply.code(401).send({ error: "Invalid webhook credential" });
    return reply.code(202).send({ accepted: true });
  });

  app.post<{ Params: { roomId: string } }>("/webhooks/agora/rooms/:roomId/agent/stop", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${config.WEBHOOK_SECRET}`) return reply.code(401).send({ error: "Invalid webhook credential" });
    await rooms.stopAgent(request.params.roomId);
    return reply.code(202).send({ ok: true });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", details: error.issues.map((issue) => issue.message) });
    const caught = error instanceof Error ? error : new Error(String(error));
    const statusCode = "statusCode" in caught && typeof caught.statusCode === "number" ? caught.statusCode : 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({ error: statusCode >= 500 ? "The meeting service could not complete the request" : caught.message });
  });

  app.addHook("onClose", async () => store.close());
  return { app, store, rooms, transcription, notes, kanban, artifacts };
}

export function requestUrlForLog(url: string) {
  const queryIndex = url.search(/[?#]/);
  const path = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  return path || "/";
}

function requestForLog(request: FastifyRequest) {
  return {
    method: request.method,
    url: requestUrlForLog(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort
  };
}

function authorize(request: FastifyRequest, config: Config, roomId: string, queryToken?: string) {
  const token = queryToken || bearerToken(request.headers.authorization);
  const capability = verifyCapability(token, config.CAPABILITY_SECRET);
  if (capability.roomId !== roomId) throw Object.assign(new Error("Capability does not match this room"), { statusCode: 403 });
  return capability;
}

function requireHost(capability: Capability) {
  if (capability.role !== "host") throw Object.assign(new Error("Only the host can use this control"), { statusCode: 403 });
}

function writeSse(response: NodeJS.WritableStream, event: { sequence: number; type: string; payload: Record<string, unknown> }) {
  response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
}
