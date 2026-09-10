CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open', 'ending', 'ended')),
  host_secret_hash TEXT NOT NULL,
  agent_id TEXT,
  agent_status TEXT NOT NULL,
  conversation_mode TEXT NOT NULL,
  focus_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check CHECK (status IN ('open', 'ending', 'ended'));

CREATE INDEX IF NOT EXISTS rooms_expires_at_idx ON rooms (expires_at);

CREATE TABLE IF NOT EXISTS participants (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  rtc_uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('host', 'guest', 'ai')),
  joined_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room_id, rtc_uid)
);

DO $$
BEGIN
  IF to_regclass('public.transcripts') IS NOT NULL AND to_regclass('public.copilot_turns') IS NULL THEN
    ALTER TABLE transcripts RENAME TO copilot_turns;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS copilot_turns (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_turn_id INTEGER NOT NULL,
  turn_sequence INTEGER NOT NULL,
  speaker_uid TEXT NOT NULL,
  speaker_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  language TEXT,
  status TEXT NOT NULL CHECK (status IN ('final', 'interrupted')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (room_id, agent_turn_id, turn_sequence, speaker_uid, role)
);

CREATE INDEX IF NOT EXISTS copilot_turns_room_created_idx ON copilot_turns (room_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_kanban_cards (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('backlog', 'in_progress', 'blocked', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_uid TEXT,
  assignee TEXT,
  due_date DATE,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by_uid TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT 'Participant',
  source_turn_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE meeting_kanban_cards ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE meeting_kanban_cards ADD COLUMN IF NOT EXISTS assignee_uid TEXT;
ALTER TABLE meeting_kanban_cards ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE meeting_kanban_cards ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE meeting_kanban_cards ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meeting_kanban_cards ADD COLUMN IF NOT EXISTS created_by_name TEXT NOT NULL DEFAULT 'Participant';
ALTER TABLE meeting_kanban_cards DROP CONSTRAINT IF EXISTS meeting_kanban_cards_priority_check;
ALTER TABLE meeting_kanban_cards ADD CONSTRAINT meeting_kanban_cards_priority_check CHECK (priority IN ('low', 'medium', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS meeting_kanban_cards_room_created_idx ON meeting_kanban_cards (room_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_kanban_commands (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  source_turn_key TEXT NOT NULL,
  operation_index INTEGER NOT NULL,
  speaker_uid TEXT NOT NULL,
  operation JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (room_id, source_turn_key, operation_index)
);

CREATE INDEX IF NOT EXISTS meeting_kanban_commands_room_created_idx ON meeting_kanban_commands (room_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_kanban_activities (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  card_id TEXT,
  card_title TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'moved', 'assigned', 'tagged', 'deleted')),
  actor_uid TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'voice')),
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS meeting_kanban_activities_room_created_idx ON meeting_kanban_activities (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcription_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('agora-stt')),
  provider_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('starting', 'active', 'stopping', 'stopped', 'error')),
  subscriber_uid TEXT NOT NULL,
  publisher_uid TEXT NOT NULL,
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS transcription_sessions_room_created_idx ON transcription_sessions (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
  sequence BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  transcription_session_id TEXT NOT NULL REFERENCES transcription_sessions(id) ON DELETE CASCADE,
  source_sentence_id TEXT NOT NULL,
  identity_quality TEXT NOT NULL CHECK (identity_quality IN ('source', 'fallback')),
  speaker_uid TEXT NOT NULL,
  speaker_name TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT,
  start_ms BIGINT NOT NULL,
  duration_ms INTEGER NOT NULL,
  text_timestamp_ms BIGINT,
  speech_start_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (room_id, transcription_session_id, speaker_uid, source_sentence_id)
);

CREATE INDEX IF NOT EXISTS meeting_transcript_segments_room_sequence_idx ON meeting_transcript_segments (room_id, sequence);

CREATE TABLE IF NOT EXISTS meeting_note_versions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('live', 'final')),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  source_through_sequence BIGINT NOT NULL,
  document JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (room_id, kind, version)
);

CREATE INDEX IF NOT EXISTS meeting_note_versions_room_kind_version_idx ON meeting_note_versions (room_id, kind, version DESC);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  spoken_text TEXT,
  status TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS insights_room_created_idx ON insights (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS room_events (
  sequence BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS room_events_room_sequence_idx ON room_events (room_id, sequence);
