import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool, type QueryResultRow } from "pg";
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
import { collapseCopilotTurns } from "../copilot-turns.js";

export class PostgresStore implements Store {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 10
    });
  }

  async init() {
    const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
    await this.pool.query(await readFile(schemaPath, "utf8"));
  }

  async close() {
    await this.pool.end();
  }

  async createRoom(room: RoomRecord) {
    await this.pool.query(
      `INSERT INTO rooms
       (id, status, host_secret_hash, agent_id, agent_status, conversation_mode, focus_until, last_error, created_at, updated_at, ended_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      roomValues(room)
    );
  }

  async getRoom(roomId: string) {
    const result = await this.pool.query("SELECT * FROM rooms WHERE id = $1", [roomId]);
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async updateRoom(room: RoomRecord) {
    await this.pool.query(
      `UPDATE rooms SET status=$2, host_secret_hash=$3, agent_id=$4, agent_status=$5,
       conversation_mode=$6, focus_until=$7, last_error=$8, created_at=$9, updated_at=$10, ended_at=$11, expires_at=$12
       WHERE id=$1`,
      roomValues(room)
    );
  }

  async listActiveRooms() {
    const result = await this.pool.query("SELECT * FROM rooms WHERE status IN ('open', 'ending')");
    return result.rows.map(mapRoom);
  }

  async upsertParticipant(participant: ParticipantRecord) {
    await this.pool.query(
      `INSERT INTO participants (room_id, rtc_uid, display_name, role, joined_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (room_id, rtc_uid) DO UPDATE SET
       display_name=EXCLUDED.display_name, role=EXCLUDED.role, last_seen_at=EXCLUDED.last_seen_at`,
      [participant.roomId, participant.rtcUid, participant.displayName, participant.role, participant.joinedAt, participant.lastSeenAt]
    );
  }

  async listParticipants(roomId: string) {
    const result = await this.pool.query("SELECT * FROM participants WHERE room_id=$1 ORDER BY joined_at", [roomId]);
    return result.rows.map(mapParticipant);
  }

  async removeParticipant(roomId: string, rtcUid: string) {
    await this.pool.query("DELETE FROM participants WHERE room_id=$1 AND rtc_uid=$2", [roomId, rtcUid]);
  }

  async upsertCopilotTurn(turn: CopilotTurn) {
    const result = await this.pool.query(
      `INSERT INTO copilot_turns
       (id, room_id, agent_turn_id, turn_sequence, speaker_uid, speaker_name, role, text, language, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (room_id, agent_turn_id, turn_sequence, speaker_uid, role) DO UPDATE SET
       speaker_name=EXCLUDED.speaker_name, text=EXCLUDED.text, language=EXCLUDED.language, status=EXCLUDED.status
       WHERE (
         EXCLUDED.text IS DISTINCT FROM copilot_turns.text
         AND char_length(trim(EXCLUDED.text)) >= char_length(trim(copilot_turns.text))
       ) OR (
         EXCLUDED.text IS NOT DISTINCT FROM copilot_turns.text
         AND (EXCLUDED.speaker_name, EXCLUDED.language, EXCLUDED.status)
           IS DISTINCT FROM (copilot_turns.speaker_name, copilot_turns.language, copilot_turns.status)
       )`,
      [turn.id, turn.roomId, turn.agentTurnId, turn.turnSequence, turn.speakerUid, turn.speakerName, turn.role, turn.text, turn.language ?? null, turn.status, turn.createdAt]
    );
    return result.rowCount === 1;
  }

  async listCopilotTurns(roomId: string) {
    const result = await this.pool.query("SELECT * FROM copilot_turns WHERE room_id=$1 ORDER BY created_at", [roomId]);
    return collapseCopilotTurns(result.rows.map(mapCopilotTurn));
  }

  async listKanbanCards(roomId: string) {
    const result = await this.pool.query("SELECT * FROM meeting_kanban_cards WHERE room_id=$1 ORDER BY status, position, created_at", [roomId]);
    return result.rows.map(mapKanbanCard);
  }

  async createKanbanCard(card: KanbanCard) {
    await this.pool.query(
      `INSERT INTO meeting_kanban_cards
       (id, room_id, title, notes, status, priority, assignee_uid, assignee, due_date, tags, position, version, created_by_uid, created_by_name, source_turn_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17)`,
      kanbanCardValues(card)
    );
  }

  async updateKanbanCard(card: KanbanCard, expectedVersion: number) {
    const result = await this.pool.query(
      `UPDATE meeting_kanban_cards SET title=$3, notes=$4, status=$5, priority=$6, assignee_uid=$7, assignee=$8,
       due_date=$9, tags=$10::jsonb, position=$11, version=$12, created_by_uid=$13, created_by_name=$14,
       source_turn_key=$15, created_at=$16, updated_at=$17 WHERE id=$1 AND room_id=$2 AND version=$18`,
      [...kanbanCardValues(card), expectedVersion]
    );
    return result.rowCount === 1;
  }

  async deleteKanbanCard(roomId: string, cardId: string) {
    await this.pool.query("DELETE FROM meeting_kanban_cards WHERE room_id=$1 AND id=$2", [roomId, cardId]);
  }

  async appendKanbanActivity(activity: KanbanActivity) {
    await this.pool.query(
      `INSERT INTO meeting_kanban_activities
       (id, room_id, card_id, card_title, action, actor_uid, actor_name, source, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [activity.id, activity.roomId, activity.cardId ?? null, activity.cardTitle, activity.action, activity.actorUid, activity.actorName, activity.source, activity.detail, activity.createdAt]
    );
  }

  async listKanbanActivities(roomId: string, limit = 50) {
    const result = await this.pool.query(
      "SELECT * FROM meeting_kanban_activities WHERE room_id=$1 ORDER BY created_at DESC LIMIT $2",
      [roomId, limit]
    );
    return result.rows.map(mapKanbanActivity);
  }

  async createKanbanCommand(command: KanbanCommandRecord) {
    const result = await this.pool.query(
      `INSERT INTO meeting_kanban_commands
       (id, room_id, source_turn_key, operation_index, speaker_uid, operation, status, result, error, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11)
       ON CONFLICT (room_id, source_turn_key, operation_index) DO NOTHING`,
      kanbanCommandValues(command)
    );
    return result.rowCount === 1;
  }

  async updateKanbanCommand(command: KanbanCommandRecord) {
    await this.pool.query(
      `UPDATE meeting_kanban_commands SET operation=$6::jsonb, status=$7, result=$8::jsonb, error=$9,
       created_at=$10, updated_at=$11 WHERE id=$1 AND room_id=$2 AND source_turn_key=$3 AND operation_index=$4 AND speaker_uid=$5`,
      kanbanCommandValues(command)
    );
  }

  async createTranscriptionSession(session: TranscriptionSessionRecord) {
    await this.pool.query(
      `INSERT INTO transcription_sessions
       (id, room_id, provider, provider_session_id, status, subscriber_uid, publisher_uid, languages, last_error, created_at, updated_at, started_at, stopped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
      transcriptionSessionValues(session)
    );
  }

  async updateTranscriptionSession(session: TranscriptionSessionRecord) {
    await this.pool.query(
      `UPDATE transcription_sessions SET provider=$3, provider_session_id=$4, status=$5, subscriber_uid=$6,
       publisher_uid=$7, languages=$8::jsonb, last_error=$9, created_at=$10, updated_at=$11, started_at=$12, stopped_at=$13
       WHERE id=$1 AND room_id=$2`,
      transcriptionSessionValues(session)
    );
  }

  async getLatestTranscriptionSession(roomId: string) {
    const result = await this.pool.query(
      "SELECT * FROM transcription_sessions WHERE room_id=$1 ORDER BY created_at DESC LIMIT 1",
      [roomId]
    );
    return result.rows[0] ? mapTranscriptionSession(result.rows[0]) : null;
  }

  async upsertMeetingTranscriptSegment(input: Omit<MeetingTranscriptSegment, "sequence">) {
    const inserted = await this.pool.query(
      `INSERT INTO meeting_transcript_segments
       (id, room_id, transcription_session_id, source_sentence_id, identity_quality, speaker_uid, speaker_name,
        text, language, start_ms, duration_ms, text_timestamp_ms, speech_start_ms, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (room_id, transcription_session_id, speaker_uid, source_sentence_id) DO NOTHING
       RETURNING *`,
      meetingTranscriptValues(input)
    );
    if (inserted.rows[0]) return { accepted: true, segment: mapMeetingTranscriptSegment(inserted.rows[0]) };
    const existing = await this.pool.query(
      `SELECT * FROM meeting_transcript_segments
       WHERE room_id=$1 AND transcription_session_id=$2 AND speaker_uid=$3 AND source_sentence_id=$4`,
      [input.roomId, input.transcriptionSessionId, input.speakerUid, input.sourceSentenceId]
    );
    if (!existing.rows[0]) throw new Error("Transcript segment conflict could not be resolved");
    return { accepted: false, segment: mapMeetingTranscriptSegment(existing.rows[0]) };
  }

  async listMeetingTranscriptSegments(roomId: string) {
    const result = await this.pool.query(
      "SELECT * FROM meeting_transcript_segments WHERE room_id=$1 ORDER BY sequence",
      [roomId]
    );
    return result.rows.map(mapMeetingTranscriptSegment);
  }

  async createMeetingNoteVersion(notes: MeetingNoteVersion) {
    await this.pool.query(
      `INSERT INTO meeting_note_versions
       (id, room_id, kind, version, status, source_through_sequence, document, error, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      meetingNoteValues(notes)
    );
  }

  async updateMeetingNoteVersion(notes: MeetingNoteVersion) {
    await this.pool.query(
      `UPDATE meeting_note_versions SET kind=$3, version=$4, status=$5, source_through_sequence=$6,
       document=$7::jsonb, error=$8, created_at=$9, updated_at=$10 WHERE id=$1 AND room_id=$2`,
      meetingNoteValues(notes)
    );
  }

  async getLatestMeetingNoteVersion(roomId: string, kind: MeetingNoteKind) {
    const result = await this.pool.query(
      "SELECT * FROM meeting_note_versions WHERE room_id=$1 AND kind=$2 ORDER BY version DESC LIMIT 1",
      [roomId, kind]
    );
    return result.rows[0] ? mapMeetingNoteVersion(result.rows[0]) : null;
  }

  async listMeetingNoteVersions(roomId: string, kind?: MeetingNoteKind) {
    const result = kind
      ? await this.pool.query("SELECT * FROM meeting_note_versions WHERE room_id=$1 AND kind=$2 ORDER BY version DESC", [roomId, kind])
      : await this.pool.query("SELECT * FROM meeting_note_versions WHERE room_id=$1 ORDER BY created_at DESC", [roomId]);
    return result.rows.map(mapMeetingNoteVersion);
  }

  async appendEvent(roomId: string, type: string, payload: Record<string, unknown>) {
    const result = await this.pool.query(
      "INSERT INTO room_events (room_id, type, payload) VALUES ($1,$2,$3::jsonb) RETURNING *",
      [roomId, type, JSON.stringify(payload)]
    );
    return mapEvent(result.rows[0]);
  }

  async listEventsAfter(roomId: string, sequence: number) {
    const result = await this.pool.query(
      "SELECT * FROM room_events WHERE room_id=$1 AND sequence>$2 ORDER BY sequence",
      [roomId, sequence]
    );
    return result.rows.map(mapEvent);
  }

  async deleteExpired(now: string) {
    const result = await this.pool.query("DELETE FROM rooms WHERE expires_at <= $1", [now]);
    return result.rowCount ?? 0;
  }
}

function roomValues(room: RoomRecord) {
  return [room.id, room.status, room.hostSecretHash, room.agentId ?? null, room.agentStatus, room.conversationMode, room.focusUntil ?? null, room.lastError ?? null, room.createdAt, room.updatedAt, room.endedAt ?? null, room.expiresAt];
}

function transcriptionSessionValues(session: TranscriptionSessionRecord) {
  return [session.id, session.roomId, session.provider, session.providerSessionId ?? null, session.status, session.subscriberUid, session.publisherUid, JSON.stringify(session.languages), session.lastError ?? null, session.createdAt, session.updatedAt, session.startedAt ?? null, session.stoppedAt ?? null];
}

function meetingTranscriptValues(segment: Omit<MeetingTranscriptSegment, "sequence">) {
  return [segment.id, segment.roomId, segment.transcriptionSessionId, segment.sourceSentenceId, segment.identityQuality, segment.speakerUid, segment.speakerName, segment.text, segment.language ?? null, segment.startMs, segment.durationMs, segment.textTimestampMs ?? null, segment.speechStartMs ?? null, segment.createdAt];
}

function meetingNoteValues(notes: MeetingNoteVersion) {
  return [notes.id, notes.roomId, notes.kind, notes.version, notes.status, notes.sourceThroughSequence, notes.document ? JSON.stringify(notes.document) : null, notes.error ?? null, notes.createdAt, notes.updatedAt];
}

function kanbanCardValues(card: KanbanCard) {
  return [card.id, card.roomId, card.title, card.notes, card.status, card.priority, card.assigneeUid ?? null, card.assignee ?? null, card.dueDate ?? null, JSON.stringify(card.tags), card.position, card.version, card.createdByUid, card.createdByName, card.sourceTurnKey, card.createdAt, card.updatedAt];
}

function kanbanCommandValues(command: KanbanCommandRecord) {
  return [command.id, command.roomId, command.sourceTurnKey, command.operationIndex, command.speakerUid, JSON.stringify(command.operation), command.status, command.result ? JSON.stringify(command.result) : null, command.error ?? null, command.createdAt, command.updatedAt];
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRoom(row: QueryResultRow): RoomRecord {
  return { id: row.id, status: row.status, hostSecretHash: row.host_secret_hash, agentId: row.agent_id ?? undefined, agentStatus: row.agent_status, conversationMode: row.conversation_mode, focusUntil: row.focus_until ? iso(row.focus_until) : undefined, lastError: row.last_error ?? undefined, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), endedAt: row.ended_at ? iso(row.ended_at) : undefined, expiresAt: iso(row.expires_at) };
}

function mapParticipant(row: QueryResultRow): ParticipantRecord {
  return { roomId: row.room_id, rtcUid: row.rtc_uid, displayName: row.display_name, role: row.role, joinedAt: iso(row.joined_at), lastSeenAt: iso(row.last_seen_at) };
}

function mapCopilotTurn(row: QueryResultRow): CopilotTurn {
  return { id: row.id, roomId: row.room_id, agentTurnId: row.agent_turn_id, turnSequence: row.turn_sequence, speakerUid: row.speaker_uid, speakerName: row.speaker_name, role: row.role, text: row.text, language: row.language ?? undefined, status: row.status, createdAt: iso(row.created_at) };
}

function mapKanbanCard(row: QueryResultRow): KanbanCard {
  return { id: row.id, roomId: row.room_id, title: row.title, notes: row.notes, status: row.status, priority: row.priority, assigneeUid: row.assignee_uid ?? undefined, assignee: row.assignee ?? undefined, dueDate: row.due_date ? iso(row.due_date).slice(0, 10) : undefined, tags: Array.isArray(row.tags) ? row.tags : [], position: Number(row.position), version: Number(row.version), createdByUid: row.created_by_uid, createdByName: row.created_by_name, sourceTurnKey: row.source_turn_key, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function mapKanbanActivity(row: QueryResultRow): KanbanActivity {
  return { id: row.id, roomId: row.room_id, cardId: row.card_id ?? undefined, cardTitle: row.card_title, action: row.action, actorUid: row.actor_uid, actorName: row.actor_name, source: row.source, detail: row.detail, createdAt: iso(row.created_at) };
}

function mapTranscriptionSession(row: QueryResultRow): TranscriptionSessionRecord {
  return { id: row.id, roomId: row.room_id, provider: row.provider, providerSessionId: row.provider_session_id ?? undefined, status: row.status, subscriberUid: row.subscriber_uid, publisherUid: row.publisher_uid, languages: Array.isArray(row.languages) ? row.languages : [], lastError: row.last_error ?? undefined, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), startedAt: row.started_at ? iso(row.started_at) : undefined, stoppedAt: row.stopped_at ? iso(row.stopped_at) : undefined };
}

function mapMeetingTranscriptSegment(row: QueryResultRow): MeetingTranscriptSegment {
  return { id: row.id, roomId: row.room_id, transcriptionSessionId: row.transcription_session_id, sequence: Number(row.sequence), sourceSentenceId: row.source_sentence_id, identityQuality: row.identity_quality, speakerUid: row.speaker_uid, speakerName: row.speaker_name, text: row.text, language: row.language ?? undefined, startMs: Number(row.start_ms), durationMs: Number(row.duration_ms), textTimestampMs: row.text_timestamp_ms == null ? undefined : Number(row.text_timestamp_ms), speechStartMs: row.speech_start_ms == null ? undefined : Number(row.speech_start_ms), createdAt: iso(row.created_at) };
}

function mapMeetingNoteVersion(row: QueryResultRow): MeetingNoteVersion {
  return { id: row.id, roomId: row.room_id, kind: row.kind, version: row.version, status: row.status, sourceThroughSequence: Number(row.source_through_sequence), document: row.document ?? undefined, error: row.error ?? undefined, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function mapEvent(row: QueryResultRow): RoomEvent {
  return { sequence: Number(row.sequence), roomId: row.room_id, type: row.type, payload: row.payload ?? {}, createdAt: iso(row.created_at) };
}
