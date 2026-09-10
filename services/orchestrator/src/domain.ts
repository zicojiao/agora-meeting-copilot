export type ParticipantRole = "host" | "guest" | "ai";
export type RoomStatus = "open" | "ending" | "ended";
export type AgentStatus =
  | "offline"
  | "joining"
  | "standby"
  | "focused"
  | "thinking"
  | "speaking"
  | "recovering"
  | "error";
export type ConversationMode = "standby" | "focused";
export type KanbanStatus = "backlog" | "in_progress" | "blocked" | "done";
export type KanbanPriority = "low" | "medium" | "high" | "urgent";

export type RoomRecord = {
  id: string;
  status: RoomStatus;
  hostSecretHash: string;
  agentId?: string;
  agentStatus: AgentStatus;
  conversationMode: ConversationMode;
  focusUntil?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  expiresAt: string;
};

export type ParticipantRecord = {
  roomId: string;
  rtcUid: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: string;
  lastSeenAt: string;
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

export type KanbanOperationType = "create" | "move" | "update" | "add_tags" | "delete";

export type KanbanOperation = {
  type: KanbanOperationType;
  cardId?: string;
  cardQuery?: string;
  title?: string;
  notes?: string;
  status?: KanbanStatus;
  assignee?: string;
  tags?: string[];
  priority?: KanbanPriority;
  dueDate?: string;
  clearAssignee?: boolean;
  clearDueDate?: boolean;
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

export type KanbanCommandRecord = {
  id: string;
  roomId: string;
  sourceTurnKey: string;
  operationIndex: number;
  speakerUid: string;
  operation: KanbanOperation;
  status: "pending" | "completed" | "failed";
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type TranscriptionStatus = "starting" | "active" | "stopping" | "stopped" | "error";

export type TranscriptionSessionRecord = {
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

export type MeetingNoteEvidence = {
  segmentId: string;
  speakerUid: string;
  speakerName: string;
  startMs: number;
};

export type MeetingNoteDecision = {
  text: string;
  evidence: MeetingNoteEvidence[];
};

export type MeetingNoteActionItem = {
  text: string;
  owner?: string;
  due?: string;
  explicitness: "explicit" | "inferred";
  evidence: MeetingNoteEvidence[];
};

export type MeetingNoteItem = {
  text: string;
  evidence: MeetingNoteEvidence[];
};

export type MeetingNotesDocument = {
  title: string;
  overview: string;
  topics: string[];
  decisions: MeetingNoteDecision[];
  actionItems: MeetingNoteActionItem[];
  openQuestions: MeetingNoteItem[];
  keyPoints: MeetingNoteItem[];
  sourceQuality: "good" | "partial" | "insufficient";
};

export type MeetingNoteKind = "live" | "final";
export type MeetingNoteStatus = "pending" | "completed" | "failed";

export type MeetingNoteVersion = {
  id: string;
  roomId: string;
  kind: MeetingNoteKind;
  version: number;
  status: MeetingNoteStatus;
  sourceThroughSequence: number;
  document?: MeetingNotesDocument;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type RoomEvent = {
  sequence: number;
  roomId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type Capability = {
  roomId: string;
  rtcUid: string;
  displayName: string;
  role: ParticipantRole;
  exp: number;
};

export type RoomSnapshot = {
  room: Omit<RoomRecord, "hostSecretHash" | "agentId">;
  participants: ParticipantRecord[];
  transcription: TranscriptionSessionRecord | null;
  transcriptSegments: MeetingTranscriptSegment[];
  liveNotes: MeetingNoteVersion | null;
  finalNotes: MeetingNoteVersion | null;
  copilotTurns: CopilotTurn[];
  kanbanCards: KanbanCard[];
  kanbanActivities: KanbanActivity[];
};
