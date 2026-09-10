"use client";

import { useEffect, useRef } from "react";

export function useParticipantSounds(uids: string[], connectionState: string) {
  const previousRef = useRef(new Set<string>());
  const mountedAt = useRef(Date.now());
  const connectionRef = useRef(connectionState);
  const suppressUntilRef = useRef(Date.now() + 2_000);

  useEffect(() => {
    const next = new Set(uids);
    const previous = previousRef.current;
    const previousConnection = connectionRef.current;
    connectionRef.current = connectionState;
    if (connectionState !== "connected") {
      previousRef.current = next;
      return;
    }
    if (previousConnection !== "connected") {
      suppressUntilRef.current = Date.now() + 2_500;
      previousRef.current = next;
      return;
    }
    const added = [...next].some((uid) => !previous.has(uid));
    const removed = [...previous].some((uid) => !next.has(uid));
    previousRef.current = next;

    if (Date.now() - mountedAt.current < 2_000 || Date.now() < suppressUntilRef.current || Math.max(next.size, previous.size) > 20) return;
    if (added) playMeetingTone("join");
    else if (removed) playMeetingTone("leave");
  }, [connectionState, uids]);
}

function playMeetingTone(kind: "join" | "leave") {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    gain.connect(context.destination);
    const frequencies = kind === "join" ? [520, 700] : [620, 420];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now + index * 0.1);
      oscillator.stop(now + 0.18 + index * 0.1);
    });
    window.setTimeout(() => void context.close(), 500);
  } catch {
    // Sound is a convenience and should never interrupt the meeting.
  }
}
