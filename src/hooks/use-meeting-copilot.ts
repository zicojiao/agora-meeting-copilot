"use client";

import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  TranscriptHelperMode,
  type RTCEngine,
  type RTMEngine
} from "agora-agent-client-toolkit";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RtmClientLike, RtmMessageEvent } from "./use-agora-room";
import {
  getRoomState,
  interruptCopilot,
  roomEventsUrl,
  startCopilot,
  stopCopilot,
  submitCopilotTurn,
  type AgentStatus,
  type CopilotTurn,
  type RoomSession,
  type RoomState,
  type MeetingNoteVersion,
  type MeetingTranscriptSegment,
  type KanbanCard,
  type KanbanActivity,
  type TranscriptionSession
} from "@/lib/meeting-api";
import { mergeVisibleMeetingNotes } from "@/lib/meeting-notes";
import { copilotName } from "@/lib/product";
import { shouldSilenceCopilotTurnSubmissionError } from "@/lib/copilot-errors";
import {
  copilotTurnFingerprint,
  copilotTurnKey,
  parseCopilotTurn,
  parseToolkitCopilotTurn,
  type CopilotTurnInput,
  upsertCopilotTurn
} from "@/lib/copilot-turns";

const sseEvents = [
  "agent.status",
  "agent.focus",
  "participant.joined",
  "participant.left",
  "copilot.turn.final",
  "kanban.board.updated",
  "transcription.status",
  "transcript.segment.final",
  "notes.live.status",
  "notes.live.completed",
  "notes.final.status",
  "notes.final.completed",
  "meeting.ending",
  "meeting.ended"
];

export function useMeetingCopilot({
  roomId,
  session,
  rtcClient,
  rtmClient,
  participantNames
}: {
  roomId: string;
  session: RoomSession;
  rtcClient: IAgoraRTCClient | null;
  rtmClient: RtmClientLike | null;
  participantNames: Record<string, string>;
}) {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const namesRef = useRef(participantNames);
  const submittedRef = useRef(new Map<string, string>());
  namesRef.current = participantNames;

  const acceptTurn = useCallback((parsed: CopilotTurnInput) => {
    const key = copilotTurnKey(parsed);
    const fingerprint = copilotTurnFingerprint(parsed);
    const createdAt = parsed.createdAt ?? new Date().toISOString();
    setState((current) => current ? {
      ...current,
      copilotTurns: upsertCopilotTurn(current.copilotTurns, { ...parsed, id: key, roomId, createdAt })
    } : current);
    if (submittedRef.current.get(key) === fingerprint) return;
    submittedRef.current.set(key, fingerprint);
    void submitCopilotTurn(roomId, session.capability, parsed).catch((caught) => {
      if (submittedRef.current.get(key) === fingerprint) submittedRef.current.delete(key);
      // Agora may deliver another participant's transcript to every client. The
      // server must reject that submission, but it is expected and non-actionable.
      if (shouldSilenceCopilotTurnSubmissionError(caught)) return;
      setError(message(caught));
    });
  }, [roomId, session.capability]);

  const refresh = useCallback(async () => {
    try {
      setState(await getRoomState(roomId, session.capability));
    } catch (caught) {
      setError(message(caught));
    }
  }, [roomId, session.capability]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    let lastEventId = 0;
    const consume = async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(roomEventsUrl(roomId, lastEventId), {
            headers: { authorization: `Bearer ${session.capability}` },
            signal: controller.signal
          });
          if (!response.ok || !response.body) throw new Error(`Event stream returned ${response.status}`);
          failures = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              const parsed = parseSseBlock(block);
              if (!parsed) continue;
              lastEventId = parsed.id || lastEventId;
              if (!sseEvents.includes(parsed.type)) continue;
              applyEvent(parsed.type, parsed.payload, setState);
            }
          }
        } catch {
          if (controller.signal.aborted) return;
          failures += 1;
          if (failures >= 3) setError(`${copilotName} state is reconnecting.`);
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(1000 * failures, 5000)));
        }
      }
    };
    void consume();
    return () => controller.abort();
  }, [roomId, session.capability]);

  useEffect(() => {
    if (!rtcClient || !rtmClient) return;
    let cancelled = false;
    let voiceAI: AgoraVoiceAI | null = null;
    void (async () => {
      const ai = await AgoraVoiceAI.init({
        rtcEngine: rtcClient as unknown as RTCEngine,
        rtmConfig: { rtmEngine: rtmClient as unknown as RTMEngine },
        renderMode: TranscriptHelperMode.TEXT,
        enableLog: false
      });
      if (cancelled) {
        if (AgoraVoiceAI.getState() && AgoraVoiceAI.getInstance() === ai) {
          ai.unsubscribe();
          ai.destroy();
        }
        return;
      }
      voiceAI = ai;
      ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (history) => {
        for (const item of history) {
          const parsed = parseToolkitCopilotTurn(item);
          if (parsed) acceptTurn(parsed);
        }
      });
      ai.subscribeMessage(session.channel);
    })().catch((caught) => {
      if (!cancelled) setError(`Agora transcript helper failed: ${message(caught)}`);
    });
    return () => {
      cancelled = true;
      if (voiceAI && AgoraVoiceAI.getState() && AgoraVoiceAI.getInstance() === voiceAI) {
        voiceAI.unsubscribe();
        voiceAI.destroy();
      }
    };
  }, [acceptTurn, rtcClient, rtmClient, session.channel]);

  useEffect(() => {
    if (!rtmClient) return;
    const onMessage = (incoming: RtmMessageEvent) => {
      try {
        const text = typeof incoming.message === "string" ? incoming.message : new TextDecoder().decode(incoming.message);
        const payload = JSON.parse(text) as Record<string, unknown>;
        const parsed = parseCopilotTurn(payload, namesRef.current);
        // The toolkit owns assistant transcript history. Raw RTM remains the
        // source for user transcription so one assistant turn has one owner.
        if (!parsed || parsed.role !== "user") return;
        acceptTurn(parsed);
      } catch {
        // Participant profile and other RTM control payloads are handled elsewhere.
      }
    };
    rtmClient.addEventListener("message", onMessage as (event: never) => void);
    return () => rtmClient.removeEventListener("message", onMessage as (event: never) => void);
  }, [acceptTurn, rtmClient]);

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setError(null);
    try { await operation(); }
    catch (caught) { setError(message(caught)); throw caught; }
  }, []);

  return {
    state,
    status: state?.room.agentStatus ?? "offline" as AgentStatus,
    error,
    clearError: () => setError(null),
    interrupt: () => run(async () => {
      const result = await interruptCopilot(roomId, session.capability);
      setState((current) => current ? {
        ...current,
        room: { ...current.room, agentStatus: result.status }
      } : current);
    }),
    start: () => run(() => startCopilot(roomId, session.capability)),
    stop: () => run(() => stopCopilot(roomId, session.capability))
  };
}

function applyEvent(
  type: string,
  payload: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<RoomState | null>>
) {
  setState((current) => {
    if (!current) return current;
    if (type === "agent.status" && typeof payload.status === "string") {
      return { ...current, room: { ...current.room, agentStatus: payload.status as AgentStatus, lastError: typeof payload.error === "string" ? payload.error : current.room.lastError } };
    }
    if (type === "agent.focus") {
      const mode = payload.mode === "focused" ? "focused" : "standby";
      return { ...current, room: { ...current.room, conversationMode: mode, agentStatus: mode === "focused" && current.room.agentStatus === "standby" ? "focused" : current.room.agentStatus, focusUntil: typeof payload.focusUntil === "string" ? payload.focusUntil : undefined } };
    }
    if (type === "copilot.turn.final" && payload.turn) {
      return { ...current, copilotTurns: upsertCopilotTurn(current.copilotTurns, payload.turn as CopilotTurn) };
    }
    if (type === "kanban.board.updated" && Array.isArray(payload.cards)) {
      return { ...current, kanbanCards: payload.cards as KanbanCard[], kanbanActivities: Array.isArray(payload.activities) ? payload.activities as KanbanActivity[] : current.kanbanActivities };
    }
    if (type === "transcription.status" && payload.transcription) {
      return { ...current, transcription: payload.transcription as TranscriptionSession };
    }
    if (type === "transcript.segment.final" && payload.segment) {
      const segment = payload.segment as MeetingTranscriptSegment;
      return { ...current, transcriptSegments: upsertSegment(current.transcriptSegments, segment) };
    }
    if ((type === "notes.live.status" || type === "notes.live.completed") && payload.notes) {
      return { ...current, liveNotes: mergeVisibleMeetingNotes(current.liveNotes, payload.notes as MeetingNoteVersion) };
    }
    if ((type === "notes.final.status" || type === "notes.final.completed") && payload.notes) {
      return { ...current, finalNotes: mergeVisibleMeetingNotes(current.finalNotes, payload.notes as MeetingNoteVersion) };
    }
    if ((type === "meeting.ending" || type === "meeting.ended") && payload.room) {
      return { ...current, room: { ...current.room, ...(payload.room as RoomState["room"]) }, finalNotes: payload.finalNotes ? payload.finalNotes as MeetingNoteVersion : current.finalNotes };
    }
    if (type === "participant.joined" && payload.rtcUid) {
      const rtcUid = String(payload.rtcUid);
      if (current.participants.some((item) => item.rtcUid === rtcUid)) return current;
      const now = new Date().toISOString();
      return { ...current, participants: [...current.participants, { roomId: current.room.id, rtcUid, displayName: String(payload.displayName || `Guest ${rtcUid}`), role: payload.role === "host" ? "host" : payload.role === "ai" ? "ai" : "guest", joinedAt: now, lastSeenAt: now }] };
    }
    if (type === "participant.left" && payload.rtcUid) {
      const rtcUid = String(payload.rtcUid);
      return { ...current, participants: current.participants.filter((item) => item.rtcUid !== rtcUid) };
    }
    return current;
  });
}

function upsertSegment(segments: MeetingTranscriptSegment[], segment: MeetingTranscriptSegment) {
  return [...segments.filter((item) => item.id !== segment.id), segment].sort((a, b) => a.sequence - b.sequence);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : `${copilotName} request failed.`;
}

function parseSseBlock(block: string) {
  if (!block || block.startsWith(":")) return null;
  let id = 0;
  let type = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim()) || 0;
    else if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { id, type, payload: JSON.parse(data.join("\n")) as Record<string, unknown> };
}
