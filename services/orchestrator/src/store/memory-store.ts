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
import type { Store } from "./store.js";
import { collapseCopilotTurns, copilotTurnKey, shouldReplaceCopilotTurn } from "../copilot-turns.js";

export class MemoryStore implements Store {
  private rooms = new Map<string, RoomRecord>();
  private participants = new Map<string, Map<string, ParticipantRecord>>();
  private copilotTurns = new Map<string, Map<string, CopilotTurn>>();
  private kanbanCards = new Map<string, Map<string, KanbanCard>>();
  private kanbanCommands = new Map<string, Map<string, KanbanCommandRecord>>();
  private kanbanActivities = new Map<string, KanbanActivity[]>();
  private transcriptionSessions = new Map<string, TranscriptionSessionRecord[]>();
  private transcriptSegments = new Map<string, Map<string, MeetingTranscriptSegment>>();
  private noteVersions = new Map<string, MeetingNoteVersion[]>();
  private events = new Map<string, RoomEvent[]>();
  private sequence = 0;
  private transcriptSequence = 0;

  async init() {}
  async close() {}

  async createRoom(room: RoomRecord) {
    this.rooms.set(room.id, structuredClone(room));
  }

  async getRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    return room ? structuredClone(room) : null;
  }

  async updateRoom(room: RoomRecord) {
    this.rooms.set(room.id, structuredClone(room));
  }

  async listActiveRooms() {
    return [...this.rooms.values()]
      .filter((room) => room.status !== "ended")
      .map((room) => structuredClone(room));
  }

  async upsertParticipant(participant: ParticipantRecord) {
    const room = this.participants.get(participant.roomId) ?? new Map<string, ParticipantRecord>();
    room.set(participant.rtcUid, structuredClone(participant));
    this.participants.set(participant.roomId, room);
  }

  async removeParticipant(roomId: string, rtcUid: string) {
    const room = this.participants.get(roomId);
    room?.delete(rtcUid);
    if (room && room.size === 0) this.participants.delete(roomId);
  }

  async listParticipants(roomId: string) {
    return [...(this.participants.get(roomId)?.values() ?? [])].map((participant) => structuredClone(participant));
  }

  async upsertCopilotTurn(turn: CopilotTurn) {
    const room = this.copilotTurns.get(turn.roomId) ?? new Map<string, CopilotTurn>();
    const key = copilotTurnKey(turn);
    const existing = room.get(key);
    if (existing && !shouldReplaceCopilotTurn(existing, turn)) return false;
    room.set(key, structuredClone(existing ? { ...turn, id: existing.id, createdAt: existing.createdAt } : turn));
    this.copilotTurns.set(turn.roomId, room);
    return true;
  }

  async listCopilotTurns(roomId: string) {
    return collapseCopilotTurns([...(this.copilotTurns.get(roomId)?.values() ?? [])]
      .map((turn) => structuredClone(turn))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  async listKanbanCards(roomId: string) {
    return [...(this.kanbanCards.get(roomId)?.values() ?? [])]
      .map((card) => structuredClone(card))
      .sort((a, b) => a.status.localeCompare(b.status) || a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }

  async createKanbanCard(card: KanbanCard) {
    const room = this.kanbanCards.get(card.roomId) ?? new Map<string, KanbanCard>();
    room.set(card.id, structuredClone(card));
    this.kanbanCards.set(card.roomId, room);
  }

  async updateKanbanCard(card: KanbanCard, expectedVersion: number) {
    const room = this.kanbanCards.get(card.roomId);
    if (!room?.has(card.id)) throw new Error("Kanban card not found");
    if (room.get(card.id)?.version !== expectedVersion) return false;
    room.set(card.id, structuredClone(card));
    return true;
  }

  async deleteKanbanCard(roomId: string, cardId: string) {
    this.kanbanCards.get(roomId)?.delete(cardId);
  }

  async appendKanbanActivity(activity: KanbanActivity) {
    const room = this.kanbanActivities.get(activity.roomId) ?? [];
    room.push(structuredClone(activity));
    this.kanbanActivities.set(activity.roomId, room);
  }

  async listKanbanActivities(roomId: string, limit = 50) {
    return (this.kanbanActivities.get(roomId) ?? [])
      .slice(-limit)
      .reverse()
      .map((activity) => structuredClone(activity));
  }

  async createKanbanCommand(command: KanbanCommandRecord) {
    const room = this.kanbanCommands.get(command.roomId) ?? new Map<string, KanbanCommandRecord>();
    const key = kanbanCommandKey(command);
    if (room.has(key)) return false;
    room.set(key, structuredClone(command));
    this.kanbanCommands.set(command.roomId, room);
    return true;
  }

  async updateKanbanCommand(command: KanbanCommandRecord) {
    const room = this.kanbanCommands.get(command.roomId);
    if (!room?.has(kanbanCommandKey(command))) throw new Error("Kanban command not found");
    room.set(kanbanCommandKey(command), structuredClone(command));
  }

  async createTranscriptionSession(session: TranscriptionSessionRecord) {
    const room = this.transcriptionSessions.get(session.roomId) ?? [];
    room.push(structuredClone(session));
    this.transcriptionSessions.set(session.roomId, room);
  }

  async updateTranscriptionSession(session: TranscriptionSessionRecord) {
    const room = this.transcriptionSessions.get(session.roomId) ?? [];
    const index = room.findIndex((item) => item.id === session.id);
    if (index < 0) room.push(structuredClone(session));
    else room[index] = structuredClone(session);
    this.transcriptionSessions.set(session.roomId, room);
  }

  async getLatestTranscriptionSession(roomId: string) {
    const sessions = this.transcriptionSessions.get(roomId) ?? [];
    const latest = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return latest ? structuredClone(latest) : null;
  }

  async upsertMeetingTranscriptSegment(input: Omit<MeetingTranscriptSegment, "sequence">) {
    const room = this.transcriptSegments.get(input.roomId) ?? new Map<string, MeetingTranscriptSegment>();
    const key = meetingTranscriptKey(input);
    const existing = room.get(key);
    if (existing) return { accepted: false, segment: structuredClone(existing) };
    const segment: MeetingTranscriptSegment = { ...structuredClone(input), sequence: ++this.transcriptSequence };
    room.set(key, segment);
    this.transcriptSegments.set(input.roomId, room);
    return { accepted: true, segment: structuredClone(segment) };
  }

  async listMeetingTranscriptSegments(roomId: string) {
    return [...(this.transcriptSegments.get(roomId)?.values() ?? [])]
      .map((segment) => structuredClone(segment))
      .sort((a, b) => a.sequence - b.sequence);
  }

  async createMeetingNoteVersion(notes: MeetingNoteVersion) {
    const room = this.noteVersions.get(notes.roomId) ?? [];
    room.push(structuredClone(notes));
    this.noteVersions.set(notes.roomId, room);
  }

  async updateMeetingNoteVersion(notes: MeetingNoteVersion) {
    const room = this.noteVersions.get(notes.roomId) ?? [];
    const index = room.findIndex((item) => item.id === notes.id);
    if (index < 0) room.push(structuredClone(notes));
    else room[index] = structuredClone(notes);
    this.noteVersions.set(notes.roomId, room);
  }

  async getLatestMeetingNoteVersion(roomId: string, kind: MeetingNoteKind) {
    const latest = [...(this.noteVersions.get(roomId) ?? [])]
      .filter((item) => item.kind === kind)
      .sort((a, b) => b.version - a.version)[0];
    return latest ? structuredClone(latest) : null;
  }

  async listMeetingNoteVersions(roomId: string, kind?: MeetingNoteKind) {
    return (this.noteVersions.get(roomId) ?? [])
      .filter((item) => !kind || item.kind === kind)
      .map((item) => structuredClone(item))
      .sort((a, b) => b.version - a.version);
  }

  async appendEvent(roomId: string, type: string, payload: Record<string, unknown>) {
    const event: RoomEvent = {
      sequence: ++this.sequence,
      roomId,
      type,
      payload: structuredClone(payload),
      createdAt: new Date().toISOString()
    };
    const room = this.events.get(roomId) ?? [];
    room.push(event);
    this.events.set(roomId, room);
    return structuredClone(event);
  }

  async listEventsAfter(roomId: string, sequence: number) {
    return (this.events.get(roomId) ?? [])
      .filter((event) => event.sequence > sequence)
      .map((event) => structuredClone(event));
  }

  async deleteExpired(now: string) {
    let count = 0;
    for (const [roomId, room] of this.rooms) {
      if (room.expiresAt <= now) {
        this.rooms.delete(roomId);
        this.participants.delete(roomId);
        this.copilotTurns.delete(roomId);
        this.kanbanCards.delete(roomId);
        this.kanbanCommands.delete(roomId);
        this.kanbanActivities.delete(roomId);
        this.transcriptionSessions.delete(roomId);
        this.transcriptSegments.delete(roomId);
        this.noteVersions.delete(roomId);
        this.events.delete(roomId);
        count += 1;
      }
    }
    return count;
  }
}

function kanbanCommandKey(command: Pick<KanbanCommandRecord, "sourceTurnKey" | "operationIndex">) {
  return `${command.sourceTurnKey}:${command.operationIndex}`;
}

function meetingTranscriptKey(segment: Pick<MeetingTranscriptSegment, "transcriptionSessionId" | "speakerUid" | "sourceSentenceId">) {
  return `${segment.transcriptionSessionId}:${segment.speakerUid}:${segment.sourceSentenceId}`;
}
