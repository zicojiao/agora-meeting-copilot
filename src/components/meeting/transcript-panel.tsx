"use client";

import { Captions, Check, Eraser, Waves } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TranscriptionSession } from "@/lib/meeting-api";
import { visibleTranscriptEntries, type UnifiedTranscriptEntry } from "@/lib/unified-transcript";
import { cn } from "@/lib/utils";

export function TranscriptPanel({
  captionsOn,
  entries,
  onClear,
  selectedSegmentId,
  transcription,
  onCaptionsChange
}: {
  captionsOn: boolean;
  entries: UnifiedTranscriptEntry[];
  onClear?: () => void;
  selectedSegmentId?: string;
  transcription: TranscriptionSession | null | undefined;
  onCaptionsChange: (value: boolean) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const visibleEntries = useMemo(() => visibleTranscriptEntries(entries, captionsOn), [captionsOn, entries]);

  useLayoutEffect(() => {
    if (!following) return;
    const frame = requestAnimationFrame(() => {
      const element = listRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [following, visibleEntries]);

  useEffect(() => {
    if (!selectedSegmentId) return;
    const target = document.getElementById(`segment-${selectedSegmentId}`)
      ?? document.getElementById(`copilot-turn-${selectedSegmentId}`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedSegmentId]);

  const status = transcription?.status ?? "starting";
  return (
    <div className="relative flex size-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase text-meeting-soft">
            <i className={cn("size-1.5 shrink-0 rounded-full", !captionsOn ? "bg-meeting-faint" : status === "active" ? "bg-presence" : status === "error" ? "bg-danger" : "bg-warning")} />
            <span className="truncate">{captionsOn ? transcriptionStatusLabel(status) : "Transcription off"}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {onClear ? (
              <Button
                className="h-8 gap-1.5 border-line px-2.5 text-[10px] text-meeting-muted"
                disabled={!visibleEntries.length}
                onClick={onClear}
                size="sm"
                title={visibleEntries.length ? "Clear transcript from this page" : "No transcript to clear"}
                variant="ghost"
              >
                <Eraser size={13} />Clear
              </Button>
            ) : null}
            <button
              aria-checked={captionsOn}
              className={cn("inline-flex h-8 items-center gap-2 rounded-[3px] border px-2.5 text-[10px] font-semibold", captionsOn ? "border-agora/50 bg-agora/10 text-agora" : "border-line bg-panel-raised text-meeting-muted")}
              onClick={() => onCaptionsChange(!captionsOn)}
              role="switch"
              type="button"
            >
              <Captions size={14} />Captions {captionsOn ? "on" : "off"}
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-meeting-faint">
          <span>{transcription?.languages.join(" + ") || "en-US"}</span>
          <span>{visibleEntries.length} final</span>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 48);
        }}
        ref={listRef}
      >
        {!visibleEntries.length ? (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center text-meeting-muted">
            <Waves className="mb-3 text-agora" size={22} />
            <strong className="text-sm text-meeting-soft">{captionsOn ? "Waiting for speech" : "Captions are off"}</strong>
            <p className="mt-1.5 text-xs leading-relaxed">{captionsOn ? "Final transcript turns will appear here for everyone in the meeting." : "Turn captions on to transcribe meeting participants. Copilot responses will still appear here."}</p>
          </div>
        ) : (
          <div aria-live="polite">
            {visibleEntries.map((entry) => (
              <article
                className={cn("border-b border-line px-4 py-3 transition-colors", selectedSegmentId === entry.id && "bg-agora/10")}
                id={entry.source === "meeting" ? `segment-${entry.id}` : `copilot-turn-${entry.id}`}
                key={`${entry.source}-${entry.id}`}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <strong className={cn("truncate text-xs text-meeting", entry.source === "copilot" && "text-agora")}>{entry.speakerName}</strong>
                  <time className="shrink-0 font-mono text-[9px] text-meeting-faint">{formatTime(entry.startMs)}</time>
                </div>
                <p className="text-[13px] leading-relaxed text-meeting-soft">{entry.text}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      {!following ? <Button className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-xl" onClick={() => { setFollowing(true); requestAnimationFrame(() => { const element = listRef.current; if (element) element.scrollTop = element.scrollHeight; }); }} size="sm" variant="secondary"><Check size={13} />Jump to live</Button> : null}
    </div>
  );
}

function transcriptionStatusLabel(status: TranscriptionSession["status"]) {
  return ({ starting: "Starting transcript", active: "Transcribing", stopping: "Finishing transcript", stopped: "Transcript complete", error: "Transcript unavailable" })[status];
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
