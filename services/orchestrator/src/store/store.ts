import type {
  CopilotTurn,
  KanbanCard,
  KanbanActivity,
  KanbanCommandRecord,
  MeetingNoteKind,
  MeetingNoteVersion,
  MeetingTranscriptSegment,
  ParticipantRecord,
  RoomEvent,
  RoomRecord,
  TranscriptionSessionRecord
} from "../domain.js";

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  createRoom(room: RoomRecord): Promise<void>;
  getRoom(roomId: string): Promise<RoomRecord | null>;
  updateRoom(room: RoomRecord): Promise<void>;
  listActiveRooms(): Promise<RoomRecord[]>;
  upsertParticipant(participant: ParticipantRecord): Promise<void>;
  removeParticipant(roomId: string, rtcUid: string): Promise<void>;
  listParticipants(roomId: string): Promise<ParticipantRecord[]>;
  upsertCopilotTurn(turn: CopilotTurn): Promise<boolean>;
  listCopilotTurns(roomId: string): Promise<CopilotTurn[]>;
  listKanbanCards(roomId: string): Promise<KanbanCard[]>;
  createKanbanCard(card: KanbanCard): Promise<void>;
  updateKanbanCard(card: KanbanCard, expectedVersion: number): Promise<boolean>;
  deleteKanbanCard(roomId: string, cardId: string): Promise<void>;
  appendKanbanActivity(activity: KanbanActivity): Promise<void>;
  listKanbanActivities(roomId: string, limit?: number): Promise<KanbanActivity[]>;
  createKanbanCommand(command: KanbanCommandRecord): Promise<boolean>;
  updateKanbanCommand(command: KanbanCommandRecord): Promise<void>;
  createTranscriptionSession(session: TranscriptionSessionRecord): Promise<void>;
  updateTranscriptionSession(session: TranscriptionSessionRecord): Promise<void>;
  getLatestTranscriptionSession(roomId: string): Promise<TranscriptionSessionRecord | null>;
  upsertMeetingTranscriptSegment(segment: Omit<MeetingTranscriptSegment, "sequence">): Promise<{ accepted: boolean; segment: MeetingTranscriptSegment }>;
  listMeetingTranscriptSegments(roomId: string): Promise<MeetingTranscriptSegment[]>;
  createMeetingNoteVersion(notes: MeetingNoteVersion): Promise<void>;
  updateMeetingNoteVersion(notes: MeetingNoteVersion): Promise<void>;
  getLatestMeetingNoteVersion(roomId: string, kind: MeetingNoteKind): Promise<MeetingNoteVersion | null>;
  listMeetingNoteVersions(roomId: string, kind?: MeetingNoteKind): Promise<MeetingNoteVersion[]>;
  appendEvent(roomId: string, type: string, payload: Record<string, unknown>): Promise<RoomEvent>;
  listEventsAfter(roomId: string, sequence: number): Promise<RoomEvent[]>;
  deleteExpired(now: string): Promise<number>;
}
