"use client";

import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeAgoraSttMessage } from "@/lib/agora-stt";
import {
  startMeetingTranscription,
  submitMeetingTranscriptSegment,
  type RoomSession,
  type TranscriptionSession
} from "@/lib/meeting-api";
import { resolveTranscriptSpeakerName } from "@/lib/participant-profile";

export type PartialTranscriptSegment = {
  key: string;
  speakerUid: string;
  speakerName: string;
  text: string;
  language?: string;
  startMs: number;
  status: "partial" | "finalizing";
};

const copilotRtcUid = "900001";

export function shouldUseAgoraSttSegment(speakerUid: string) {
  return speakerUid !== copilotRtcUid;
}

export function shouldStartMeetingTranscription({
  captionsOn,
  connectionState,
  hasRtcClient,
  alreadyStarted,
  transcriptionStatus
}: {
  captionsOn: boolean;
  connectionState: string;
  hasRtcClient: boolean;
  alreadyStarted: boolean;
  transcriptionStatus?: TranscriptionSession["status"];
}) {
  const transcriptionRunning = transcriptionStatus === "starting" || transcriptionStatus === "active";
  return captionsOn && hasRtcClient && connectionState === "connected" && !alreadyStarted && !transcriptionRunning;
}

export function useMeetingTranscription({
  roomId,
  roomCreatedAt,
  session,
  rtcClient,
  connectionState,
  transcription,
  participantNames
}: {
  roomId: string;
  roomCreatedAt?: string;
  session: RoomSession;
  rtcClient: IAgoraRTCClient | null;
  connectionState: string;
  transcription: TranscriptionSession | null | undefined;
  participantNames: Record<string, string>;
}) {
  const [activeSession, setActiveSession] = useState<TranscriptionSession | null>(transcription ?? null);
  const [partials, setPartials] = useState<Record<string, PartialTranscriptSegment>>({});
  const [captionsOn, setCaptionsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const submittedRef = useRef(new Set<string>());
  const participantNamesRef = useRef(participantNames);
  participantNamesRef.current = participantNames;

  useEffect(() => {
    setPartials((current) => {
      let changed = false;
      const next = Object.fromEntries(Object.entries(current).map(([speakerUid, partial]) => {
        const speakerName = resolveTranscriptSpeakerName(speakerUid, participantNames);
        if (speakerName === partial.speakerName) return [speakerUid, partial];
        changed = true;
        return [speakerUid, { ...partial, speakerName }];
      }));
      return changed ? next : current;
    });
  }, [participantNames]);

  useEffect(() => {
    if (transcription) setActiveSession(transcription);
  }, [transcription]);

  useEffect(() => {
    if (!shouldStartMeetingTranscription({
      captionsOn,
      connectionState,
      hasRtcClient: Boolean(rtcClient),
      alreadyStarted: startedRef.current,
      transcriptionStatus: activeSession?.status
    })) return;
    startedRef.current = true;
    void startMeetingTranscription(roomId, session.capability)
      .then((result) => setActiveSession(result.transcription))
      .catch((caught) => {
        startedRef.current = false;
        setError(caught instanceof Error ? caught.message : "Meeting transcription could not start.");
      });
  }, [activeSession?.status, captionsOn, connectionState, roomId, rtcClient, session.capability]);

  useEffect(() => {
    if (!captionsOn || !rtcClient || !activeSession) return;
    const onStreamMessage = (uid: string | number, data: Uint8Array) => {
      if (String(uid) !== activeSession.publisherUid) return;
      let decoded;
      try {
        decoded = decodeAgoraSttMessage(data);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "A subtitle message could not be decoded.");
        return;
      }
      if (!decoded || !shouldUseAgoraSttSegment(decoded.speakerUid)) return;
      const startMs = relativeStart(decoded.sourceTimeMs, roomCreatedAt);
      const sentenceKey = decoded.sentenceId || `${decoded.textTimestampMs ?? decoded.sourceTimeMs ?? startMs}`;
      const key = `${decoded.speakerUid}:${sentenceKey}`;
      const segment: PartialTranscriptSegment = {
        key,
        speakerUid: decoded.speakerUid,
        speakerName: resolveTranscriptSpeakerName(decoded.speakerUid, participantNamesRef.current),
        text: decoded.text,
        language: decoded.language,
        startMs,
        status: decoded.isFinal ? "finalizing" : "partial"
      };
      const submissionKey = `${activeSession.id}:${key}`;
      if (submittedRef.current.has(submissionKey)) return;
      if (!decoded.isFinal) {
        setPartials((current) => upsertLiveTranscript(current, segment));
        return;
      }
      // Keep the final text visible while the server persists it. The server
      // publishes the SSE final before this request resolves, avoiding the old
      // partial -> blank -> final transition.
      setPartials((current) => upsertLiveTranscript(current, segment));
      submittedRef.current.add(submissionKey);
      void submitMeetingTranscriptSegment(roomId, session.capability, {
        transcriptionSessionId: activeSession.id,
        sourceSentenceId: decoded.sentenceId,
        speakerUid: decoded.speakerUid,
        text: decoded.text,
        language: decoded.language,
        startMs,
        durationMs: decoded.durationMs,
        textTimestampMs: decoded.textTimestampMs,
        speechStartMs: decoded.sourceTimeMs
      }).then(() => {
        setPartials((current) => removeLiveTranscript(current, key));
      }).catch((caught) => {
        submittedRef.current.delete(submissionKey);
        setPartials((current) => removeLiveTranscript(current, key));
        setError(caught instanceof Error ? caught.message : "A final transcript segment could not be saved.");
      });
    };
    rtcClient.on("stream-message", onStreamMessage);
    return () => { rtcClient.off("stream-message", onStreamMessage); };
  }, [activeSession, captionsOn, roomCreatedAt, roomId, rtcClient, session.capability]);

  const setCaptionsEnabled = (value: boolean) => {
    setCaptionsOn(value);
    if (!value) setPartials({});
  };

  return {
    transcription: activeSession,
    partialSegments: useMemo(() => captionsOn ? Object.values(partials).sort((a, b) => a.startMs - b.startMs) : [], [captionsOn, partials]),
    captionsOn,
    setCaptionsOn: setCaptionsEnabled,
    error,
    clearError: () => setError(null)
  };
}

export function upsertLiveTranscript(
  current: Record<string, PartialTranscriptSegment>,
  incoming: PartialTranscriptSegment
) {
  if (current[incoming.key]?.status === "finalizing" && incoming.status === "partial") return current;
  const next = { ...current };
  if (incoming.status === "partial") {
    for (const [key, segment] of Object.entries(next)) {
      if (key !== incoming.key && segment.speakerUid === incoming.speakerUid && segment.status === "partial") {
        delete next[key];
      }
    }
  }
  next[incoming.key] = incoming;
  return next;
}

export function removeLiveTranscript(current: Record<string, PartialTranscriptSegment>, key: string) {
  if (!current[key]) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

function relativeStart(sourceTimeMs: number | undefined, roomCreatedAt?: string) {
  if (!sourceTimeMs || !roomCreatedAt) return 0;
  return Math.max(0, sourceTimeMs - new Date(roomCreatedAt).getTime());
}
