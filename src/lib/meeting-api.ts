export type ParticipantRole = "host" | "guest" | "ai";
export type AgentStatus = "offline" | "joining" | "standby" | "focused" | "thinking" | "speaking" | "recovering" | "error";
export type TranscriptionStatus = "starting" | "active" | "stopping" | "stopped" | "error";
export type KanbanStatus = "backlog" | "in_progress" | "blocked" | "done";
export type KanbanPriority = "low" | "medium" | "high" | "urgent";

export type RoomSession = {
  capability: string;
  role: "host" | "guest";
  appId: string;
  channel: string;
  rtcUid: number;
  rtcToken: string;
  rtmToken: string;
  expiresAt: number;
};

export type RoomParticipant = {
  roomId: string;
  rtcUid: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: string;
  lastSeenAt: string;
};

export type RoomState = {
  room: {
    id: string;
    status: "open" | "ending" | "ended";
    agentStatus: AgentStatus;
    conversationMode: "standby" | "focused";
    focusUntil?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
    endedAt?: string;
    expiresAt: string;
  };
  participants: RoomParticipant[];
  transcription: TranscriptionSession | null;
  transcriptSegments: MeetingTranscriptSegment[];
  liveNotes: MeetingNoteVersion | null;
  finalNotes: MeetingNoteVersion | null;
  copilotTurns: CopilotTurn[];
  kanbanCards: KanbanCard[];
  kanbanActivities: KanbanActivity[];
};

export type KanbanCard = {
  id: string;
  roomId: string;
  title: string;
  notes: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  assigneeUid?: string;
  assignee?: string;
  dueDate?: string;
  tags: string[];
  position: number;
  version: number;
  createdByUid: string;
  createdByName: string;
  sourceTurnKey: string;
  createdAt: string;
  updatedAt: string;
};

export type KanbanActivity = {
  id: string;
  roomId: string;
  cardId?: string;
  cardTitle: string;
  action: "created" | "updated" | "moved" | "assigned" | "tagged" | "deleted";
  actorUid: string;
  actorName: string;
  source: "manual" | "voice";
  detail: string;
  createdAt: string;
};

export type CreateKanbanCardInput = {
  title: string;
  notes?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  assigneeUid?: string;
  dueDate?: string;
  tags?: string[];
};

export type UpdateKanbanCardInput = Partial<Omit<CreateKanbanCardInput, "assigneeUid" | "dueDate">> & {
  expectedVersion: number;
  assigneeUid?: string | null;
  dueDate?: string | null;
  position?: number;
};

export type CopilotTurn = {
  id: string;
  roomId: string;
  agentTurnId: number;
  turnSequence: number;
  speakerUid: string;
  speakerName: string;
  role: "user" | "assistant";
  text: string;
  language?: string;
  status: "final" | "interrupted";
  createdAt: string;
};

export type TranscriptionSession = {
  id: string;
  roomId: string;
  provider: "agora-stt";
  providerSessionId?: string;
  status: TranscriptionStatus;
  subscriberUid: string;
  publisherUid: string;
  languages: string[];
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
};

export type MeetingTranscriptSegment = {
  id: string;
  roomId: string;
  transcriptionSessionId: string;
  sequence: number;
  sourceSentenceId: string;
  identityQuality: "source" | "fallback";
  speakerUid: string;
  speakerName: string;
  text: string;
  language?: string;
  startMs: number;
  durationMs: number;
  textTimestampMs?: number;
  speechStartMs?: number;
  createdAt: string;
};

export type MeetingNoteEvidence = { segmentId: string; speakerUid: string; speakerName: string; startMs: number };
export type MeetingNotesDocument = {
  title: string;
  overview: string;
  topics: string[];
  decisions: Array<{ text: string; evidence: MeetingNoteEvidence[] }>;
  actionItems: Array<{ text: string; owner?: string; due?: string; explicitness: "explicit" | "inferred"; evidence: MeetingNoteEvidence[] }>;
  openQuestions: Array<{ text: string; evidence: MeetingNoteEvidence[] }>;
  keyPoints: Array<{ text: string; evidence: MeetingNoteEvidence[] }>;
  sourceQuality: "good" | "partial" | "insufficient";
};

export type MeetingNoteVersion = {
  id: string;
  roomId: string;
  kind: "live" | "final";
  version: number;
  status: "pending" | "completed" | "failed";
  sourceThroughSequence: number;
  document?: MeetingNotesDocument;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type EndedMeetingArtifacts = {
  room: RoomState["room"];
  transcriptSegments: MeetingTranscriptSegment[];
  copilotTurns: CopilotTurn[];
  finalNotes: MeetingNoteVersion | null;
  downloads: { transcript: string; notes: string; all: string };
};

const baseUrl = (process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:8787").replace(/\/$/, "");

export async function createMeeting() {
  return request<{ roomId: string; hostSecret: string; guestUrl: string }>("/rooms", { method: "POST" });
}

export async function joinMeeting(roomId: string, displayName: string, hostSecret?: string) {
  return request<RoomSession>(`/rooms/${encodeURIComponent(roomId)}/participants`, {
    method: "POST",
    body: JSON.stringify({ displayName, hostSecret })
  });
}

export async function leaveMeeting(roomId: string, capability: string, keepalive = false) {
  return request(`/rooms/${encodeURIComponent(roomId)}/participants/leave`, {
    method: "POST",
    headers: auth(capability),
    keepalive
  });
}

export async function getRoomState(roomId: string, capability: string) {
  return request<RoomState>(`/rooms/${encodeURIComponent(roomId)}`, { headers: auth(capability) });
}

export async function issueMediaToken(roomId: string, capability: string) {
  return request<{ appId: string; channel: string; uid: number; token: string; expiresAt: number }>(`/rooms/${encodeURIComponent(roomId)}/media-token`, { method: "POST", headers: auth(capability) });
}

export async function startCopilot(roomId: string, capability: string) {
  return request(`/rooms/${encodeURIComponent(roomId)}/agent/start`, { method: "POST", headers: auth(capability) });
}

export async function stopCopilot(roomId: string, capability: string) {
  return request(`/rooms/${encodeURIComponent(roomId)}/agent/stop`, { method: "POST", headers: auth(capability) });
}

export async function submitCopilotTurn(roomId: string, capability: string, turn: Omit<CopilotTurn, "id" | "roomId" | "createdAt"> & { createdAt?: string }) {
  return request(`/rooms/${encodeURIComponent(roomId)}/copilot/turns`, { method: "POST", headers: auth(capability), body: JSON.stringify(turn) });
}

export async function createKanbanCard(roomId: string, capability: string, input: CreateKanbanCardInput) {
  return request<{ card: KanbanCard }>(`/rooms/${encodeURIComponent(roomId)}/kanban/cards`, { method: "POST", headers: auth(capability), body: JSON.stringify(input) });
}

export async function updateKanbanCard(roomId: string, capability: string, cardId: string, input: UpdateKanbanCardInput) {
  return request<{ card: KanbanCard }>(`/rooms/${encodeURIComponent(roomId)}/kanban/cards/${encodeURIComponent(cardId)}`, { method: "PATCH", headers: auth(capability), body: JSON.stringify(input) });
}

export async function deleteKanbanCard(roomId: string, capability: string, cardId: string) {
  return request(`/rooms/${encodeURIComponent(roomId)}/kanban/cards/${encodeURIComponent(cardId)}`, { method: "DELETE", headers: auth(capability) });
}

export async function startMeetingTranscription(roomId: string, capability: string) {
  return request<{ transcription: TranscriptionSession }>(`/rooms/${encodeURIComponent(roomId)}/transcription/start`, { method: "POST", headers: auth(capability) });
}

export async function submitMeetingTranscriptSegment(roomId: string, capability: string, segment: {
  transcriptionSessionId: string;
  sourceSentenceId?: string;
  speakerUid: string;
  text: string;
  language?: string;
  startMs: number;
  durationMs: number;
  textTimestampMs?: number;
  speechStartMs?: number;
}) {
  return request<{ accepted: boolean; segment: MeetingTranscriptSegment }>(`/rooms/${encodeURIComponent(roomId)}/transcript-segments`, { method: "POST", headers: auth(capability), body: JSON.stringify(segment) });
}

export async function endMeetingForEveryone(roomId: string, capability: string) {
  return request<RoomState>(`/rooms/${encodeURIComponent(roomId)}/end`, { method: "POST", headers: auth(capability) });
}

export async function getEndedMeetingArtifacts(roomId: string) {
  return request<EndedMeetingArtifacts>(`/rooms/${encodeURIComponent(roomId)}/artifacts/status`);
}

export function meetingArtifactUrl(roomId: string, kind: "transcript.md" | "notes.md" | "all.zip") {
  return `/api/meeting-artifacts/${encodeURIComponent(roomId)}/${kind}`;
}

export function roomEventsUrl(roomId: string, after = 0) {
  return `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events?after=${after}`;
}

function auth(capability: string) {
  return { authorization: `Bearer ${capability}` };
}

async function request<T = { ok: boolean }>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers }
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Meeting service returned ${response.status}`);
  return payload;
}
