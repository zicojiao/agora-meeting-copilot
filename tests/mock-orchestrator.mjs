import { createServer } from "node:http";

const clients = new Set();
const room = {
  id: "meet-playwright",
  status: "open",
  agentStatus: "offline",
  conversationMode: "standby",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString()
};
const participants = [];
const copilotTurns = [];
const kanbanCards = [];
const kanbanActivities = [];
const transcriptSegments = [];
let transcription = null;
let liveNotes = null;
let finalNotes = null;
let sequence = 0;

const server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", request.headers.origin || "*");
  response.setHeader("access-control-allow-headers", "content-type,authorization,last-event-id");
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const url = new URL(request.url, "http://127.0.0.1:8787");
  const body = await readBody(request);

  if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { ok: true });
  if (request.method === "POST" && url.pathname === "/rooms") {
    participants.length = 0;
    copilotTurns.length = 0;
    kanbanCards.length = 0;
    kanbanActivities.length = 0;
    transcriptSegments.length = 0;
    transcription = null;
    liveNotes = null;
    finalNotes = null;
    room.status = "open";
    room.agentStatus = "offline";
    room.conversationMode = "standby";
    room.createdAt = new Date().toISOString();
    room.updatedAt = room.createdAt;
    delete room.focusUntil;
    return json(response, 201, { roomId: room.id, hostSecret: "playwright-host", guestUrl: `http://localhost:3101/?room=${room.id}` });
  }
  if (request.method === "POST" && /\/participants$/.test(url.pathname)) {
    const role = body.hostSecret === "playwright-host" ? "host" : "guest";
    const rtcUid = 100000 + participants.length + 1;
    participants.push({ roomId: room.id, rtcUid: String(rtcUid), displayName: body.displayName, role, joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    return json(response, 201, { capability: `${role}-capability`, role, appId: "a".repeat(32), channel: room.id, rtcUid, rtcToken: "invalid-test-token", rtmToken: "invalid-test-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  }
  if (request.method === "POST" && url.pathname.endsWith("/participants/leave")) {
    const role = String(request.headers.authorization || "").includes("host-capability") ? "host" : "guest";
    const index = participants.findIndex((participant) => participant.role === role);
    const [participant] = index >= 0 ? participants.splice(index, 1) : [];
    if (participant) event("participant.left", { rtcUid: participant.rtcUid, displayName: participant.displayName, role: participant.role });
    return json(response, 202, { ok: true });
  }
  if (request.method === "GET" && url.pathname.endsWith("/events")) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }
  if (request.method === "GET" && /^\/rooms\/[^/]+$/.test(url.pathname)) return json(response, 200, { room, participants, transcription, transcriptSegments, liveNotes, finalNotes, copilotTurns, kanbanCards, kanbanActivities });
  if (request.method === "POST" && url.pathname.endsWith("/kanban/cards")) {
    const actor = participantForCapability(request.headers.authorization);
    const assignee = participants.find((participant) => participant.rtcUid === body.assigneeUid);
    const card = { id: `card-${kanbanCards.length + 1}`, roomId: room.id, title: body.title, notes: body.notes || "", status: body.status || "backlog", priority: body.priority || "medium", assigneeUid: assignee?.rtcUid, assignee: assignee?.displayName, dueDate: body.dueDate, tags: body.tags || [], position: (kanbanCards.filter((item) => item.status === (body.status || "backlog")).length + 1) * 1000, version: 1, createdByUid: actor.rtcUid, createdByName: actor.displayName, sourceTurnKey: `manual:${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    kanbanCards.push(card);
    addKanbanActivity(card, actor, "manual", "created", `Created in ${card.status}`);
    boardEvent();
    return json(response, 201, { card });
  }
  const kanbanCardMatch = url.pathname.match(/\/kanban\/cards\/([^/]+)$/);
  if (request.method === "PATCH" && kanbanCardMatch) {
    const card = kanbanCards.find((item) => item.id === decodeURIComponent(kanbanCardMatch[1]));
    if (!card) return json(response, 404, { error: "Card not found" });
    if (card.version !== body.expectedVersion) return json(response, 409, { error: "This card changed in another session. Refresh and try again." });
    const actor = participantForCapability(request.headers.authorization);
    const previousStatus = card.status;
    if (body.assigneeUid !== undefined) {
      const assignee = participants.find((participant) => participant.rtcUid === body.assigneeUid);
      card.assigneeUid = assignee?.rtcUid;
      card.assignee = assignee?.displayName;
    }
    for (const field of ["title", "notes", "status", "priority", "dueDate", "tags", "position"]) if (body[field] !== undefined) card[field] = body[field] ?? undefined;
    card.version += 1;
    card.updatedAt = new Date().toISOString();
    addKanbanActivity(card, actor, "manual", card.status !== previousStatus ? "moved" : "updated", card.status !== previousStatus ? `Moved to ${card.status}` : "Updated card details");
    boardEvent();
    return json(response, 200, { card });
  }
  if (request.method === "DELETE" && kanbanCardMatch) {
    const index = kanbanCards.findIndex((item) => item.id === decodeURIComponent(kanbanCardMatch[1]));
    if (index < 0) return json(response, 404, { error: "Card not found" });
    const [card] = kanbanCards.splice(index, 1);
    addKanbanActivity(card, participantForCapability(request.headers.authorization), "manual", "deleted", "Deleted card");
    boardEvent();
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && url.pathname.endsWith("/transcription/start")) {
    transcription ||= { id: "00000000-0000-4000-8000-000000000001", roomId: room.id, provider: "agora-stt", providerSessionId: "stt-playwright", status: "active", subscriberUid: "900003", publisherUid: "900003", languages: ["zh-CN", "en-US"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), startedAt: new Date().toISOString() };
    event("transcription.status", { transcription });
    return json(response, 202, { transcription });
  }
  if (request.method === "POST" && url.pathname.endsWith("/transcript-segments")) {
    const segment = { id: `segment-${transcriptSegments.length + 1}`, roomId: room.id, sequence: transcriptSegments.length + 1, sourceSentenceId: body.sourceSentenceId || `fallback-${transcriptSegments.length + 1}`, identityQuality: body.sourceSentenceId ? "source" : "fallback", speakerName: participants.find((item) => item.rtcUid === String(body.speakerUid))?.displayName || "Participant", ...body, createdAt: new Date().toISOString() };
    transcriptSegments.push(segment);
    event("transcript.segment.final", { segment });
    return json(response, 202, { accepted: true, segment });
  }
  if (request.method === "POST" && url.pathname.endsWith("/agent/start")) {
    room.agentStatus = "joining";
    event("agent.status", { status: "joining" });
    setTimeout(() => {
      room.agentStatus = "standby";
      if (!participants.some((participant) => participant.rtcUid === "900001")) participants.push({ roomId: room.id, rtcUid: "900001", displayName: "Copilot", role: "ai", joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
      event("agent.status", { status: "standby", agentUid: "900001" });
    }, 40);
    return json(response, 202, { room });
  }
  if (request.method === "POST" && url.pathname.endsWith("/agent/stop")) {
    room.agentStatus = "offline";
    const aiIndex = participants.findIndex((participant) => participant.rtcUid === "900001");
    if (aiIndex >= 0) participants.splice(aiIndex, 1);
    event("agent.status", { status: "offline" });
    return json(response, 202, { ok: true });
  }
  if (request.method === "POST" && url.pathname.endsWith("/copilot/turns")) {
    const key = `${body.agentTurnId}:${body.turnSequence}:${body.speakerUid}:${body.role}`;
    const existing = copilotTurns.find((turn) => `${turn.agentTurnId}:${turn.turnSequence}:${turn.speakerUid}:${turn.role}` === key);
    if (existing) return json(response, 202, { accepted: false, turn: existing });
    const turn = { id: `turn-${Date.now()}-${copilotTurns.length}`, roomId: room.id, ...body, speakerName: body.role === "assistant" ? "Copilot" : body.speakerName, createdAt: body.createdAt || new Date().toISOString() };
    copilotTurns.push(turn);
    event("copilot.turn.final", { turn });
    return json(response, 202, { accepted: true, turn });
  }
  if (request.method === "POST" && url.pathname.endsWith("/media-token")) return json(response, 200, { appId: "a".repeat(32), channel: room.id, uid: 800001, token: "invalid-test-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  if (request.method === "POST" && url.pathname.endsWith("/end")) {
    room.status = "ending";
    event("meeting.ending", { room });
    await new Promise((resolve) => setTimeout(resolve, 180));
    finalNotes = { id: "notes-final", roomId: room.id, kind: "final", version: 1, status: "completed", sourceThroughSequence: transcriptSegments.length, document: { title: "Launch planning meeting", overview: "The meeting confirmed the launch plan.", topics: ["Launch planning"], decisions: [{ text: "Launch plan confirmed.", evidence: [] }], actionItems: [], openQuestions: [], keyPoints: [], sourceQuality: "good" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    room.status = "ended";
    room.endedAt = new Date().toISOString();
    room.updatedAt = room.endedAt;
    event("meeting.ended", { room, finalNotes });
    return json(response, 202, { room, participants, transcription, transcriptSegments, liveNotes, finalNotes, copilotTurns, kanbanCards, kanbanActivities });
  }
  if (request.method === "GET" && url.pathname.endsWith("/artifacts/status")) {
    if (room.status !== "ended") return json(response, 409, { error: "Meeting artifacts are available after the meeting ends" });
    return json(response, 200, { room, transcriptSegments, copilotTurns, finalNotes, downloads: { transcript: `/rooms/${room.id}/artifacts/transcript.md`, notes: `/rooms/${room.id}/artifacts/notes.md`, all: `/rooms/${room.id}/artifacts/all.zip` } });
  }
  if (request.method === "GET" && url.pathname.endsWith("/artifacts/transcript.md")) return text(response, 200, "# Transcript\n", "text/markdown");
  if (request.method === "GET" && url.pathname.endsWith("/artifacts/notes.md")) return text(response, 200, "# Notes\n", "text/markdown");
  if (request.method === "GET" && url.pathname.endsWith("/artifacts/all.zip")) return text(response, 200, "zip", "application/zip");
  return json(response, 404, { error: "Not found" });
});

server.listen(8787, "127.0.0.1");
process.on("SIGTERM", () => server.close());

function event(type, payload) {
  sequence += 1;
  const message = `id: ${sequence}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(message);
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function text(response, status, value, type) {
  response.writeHead(status, { "content-type": type });
  response.end(value);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

function participantForCapability(authorization) {
  const role = String(authorization || "").includes("host-capability") ? "host" : "guest";
  return participants.find((participant) => participant.role === role) || participants[0];
}

function addKanbanActivity(card, actor, source, action, detail) {
  kanbanActivities.unshift({ id: `activity-${Date.now()}-${kanbanActivities.length}`, roomId: room.id, cardId: action === "deleted" ? undefined : card.id, cardTitle: card.title, action, actorUid: actor?.rtcUid || "unknown", actorName: actor?.displayName || "Participant", source, detail, createdAt: new Date().toISOString() });
}

function boardEvent() {
  event("kanban.board.updated", { cards: kanbanCards, activities: kanbanActivities, activity: kanbanActivities[0] });
}
