"use client";

import type { IAgoraRTCRemoteUser, ILocalVideoTrack } from "agora-rtc-sdk-ng";
import { BotOff, CameraOff, EllipsisVertical, Mic, MicOff, MonitorUp, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AgentStatus } from "@/lib/meeting-api";
import { copilotName, copilotWakeWord, engineLabel } from "@/lib/product";
import { cn } from "@/lib/utils";

type PlayableVideoTrack = ILocalVideoTrack | NonNullable<IAgoraRTCRemoteUser["videoTrack"]>;

export function LocalParticipantTile({ active, displayName, muted, videoMuted, videoTrack }: {
  active: boolean;
  displayName: string;
  muted: boolean;
  videoMuted: boolean;
  videoTrack: ILocalVideoTrack | null;
}) {
  return (
    <ParticipantFrame active={active} className="local-tile" label={`${displayName} (You)`} muted={muted}>
      {videoTrack && !videoMuted ? <TrackPlayer track={videoTrack} /> : <ParticipantPlaceholder label={displayName} />}
    </ParticipantFrame>
  );
}

export function ScreenShareTile({ track }: { track: ILocalVideoTrack }) {
  return (
    <ParticipantFrame active={false} className="screen-tile focus-tile" label="Your screen" muted>
      <TrackPlayer contain track={track} />
      <PresentingBadge />
    </ParticipantFrame>
  );
}

export function RemoteScreenShareTile({ focused, name, user }: { focused: boolean; name?: string; user: IAgoraRTCRemoteUser }) {
  return (
    <ParticipantFrame active={false} className={cn("screen-tile", focused && "focus-tile")} label={`${name || "Participant"}'s screen`} muted={!user.hasAudio}>
      {user.videoTrack ? <TrackPlayer contain track={user.videoTrack} /> : <ParticipantPlaceholder label="Shared screen" />}
      <RemoteAudioPlayer user={user} />
      <PresentingBadge />
    </ParticipantFrame>
  );
}

export function RemoteParticipantTile({ active, name, user }: { active: boolean; name?: string; user: IAgoraRTCRemoteUser }) {
  const label = name || "Joining...";
  return (
    <ParticipantFrame active={active} className="remote-tile" label={label} muted={!user.hasAudio}>
      {user.videoTrack ? <TrackPlayer track={user.videoTrack} /> : <ParticipantPlaceholder label={label} />}
      <RemoteAudioPlayer user={user} />
    </ParticipantFrame>
  );
}

export function AiParticipantTile({ canManage, interrupting = false, onInterrupt, onRemove, status }: {
  canManage: boolean;
  interrupting?: boolean;
  onInterrupt?: () => void;
  onRemove: () => void;
  status: AgentStatus;
}) {
  const displayStatus = aiDisplayStatus(status);
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!controlsOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) setControlsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setControlsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [controlsOpen]);

  return (
    <article
      className={cn(
        "participant-tile ai-tile relative min-h-0 min-w-0 overflow-hidden rounded-[4px] border border-agora/25 bg-[radial-gradient(circle_at_50%_35%,rgba(0,194,255,0.12),transparent_48%),#11181c]",
        displayStatus.label === "Speaking" && "is-speaking border-agora/80 shadow-[0_0_0_1px_rgba(0,194,255,0.35),0_0_24px_rgba(0,194,255,0.12)]",
        `ai-${status}`
      )}
      data-ai-status={displayStatus.label.toLowerCase()}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center px-5 pb-10 text-center text-meeting">
        <span className="mb-3 flex size-16 items-center justify-center rounded-full border border-agora/30 bg-agora/10 text-agora max-sm:size-14" aria-hidden="true"><VoiceBars active={displayStatus.label === "Speaking"} /></span>
        <strong className="text-xl font-semibold max-sm:text-lg">{copilotName}</strong>
        <span className="mt-1 text-xs font-medium text-agora max-sm:text-[10px]" data-testid="copilot-status">{displayStatus.label}</span>
        <span className="mt-1 text-[11px] text-meeting-muted max-sm:hidden">{displayStatus.description}</span>
        <span className="mt-3 font-mono text-[11px] tracking-[0.04em] text-meeting-faint max-sm:mt-2 max-sm:text-[10px]" data-testid="copilot-engine-label">{engineLabel}</span>
      </div>
      {canManage ? (
        <div className="absolute right-2.5 top-2.5 z-20" ref={controlsRef}>
          <Button
            aria-controls="copilot-controls-menu"
            aria-expanded={controlsOpen}
            aria-haspopup="menu"
            aria-label={`${copilotName} controls`}
            className="rounded-[3px] border-line bg-room/75 text-meeting-muted shadow-lg backdrop-blur hover:border-agora/45 hover:bg-panel-raised hover:text-meeting"
            onClick={() => setControlsOpen((open) => !open)}
            size="icon-sm"
            title={`${copilotName} controls`}
            variant="secondary"
          >
            <EllipsisVertical size={18} />
          </Button>
          {controlsOpen ? (
            <div
              aria-label={`${copilotName} controls`}
              className="absolute right-0 top-full mt-1.5 w-52 overflow-hidden rounded-[3px] border border-line-strong bg-panel-raised p-1.5 text-left shadow-2xl"
              id="copilot-controls-menu"
              role="menu"
            >
              <button
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-xs font-medium text-meeting-soft transition-colors hover:bg-panel-hover hover:text-meeting focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agora/45 disabled:opacity-45"
                disabled={interrupting}
                onClick={() => {
                  setControlsOpen(false);
                  onInterrupt?.();
                }}
                role="menuitem"
                type="button"
              >
                <VolumeX aria-hidden="true" size={16} />
                {interrupting ? "Stopping…" : "Stop speaking"}
              </button>
              <div className="my-1 border-t border-line" />
              <button
                className="flex w-full items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/45"
                onClick={() => {
                  setControlsOpen(false);
                  onRemove();
                }}
                role="menuitem"
                type="button"
              >
                <BotOff aria-hidden="true" size={16} />
                Remove from meeting
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="participant-label absolute inset-x-2 bottom-2 flex min-h-7 items-center justify-between gap-3 rounded-[3px] bg-room/80 px-2.5 text-[11px] backdrop-blur">
        <span className="flex min-w-0 items-center gap-1.5 truncate"><span className="size-1.5 shrink-0 rounded-full bg-presence" />{copilotName}</span>
        <span className="font-mono text-[9px] uppercase text-meeting-muted max-sm:hidden">{displayStatus.label}</span>
      </div>
    </article>
  );
}

function ParticipantFrame({ active, children, className, label, muted }: { active: boolean; children: React.ReactNode; className: string; label: string; muted: boolean }) {
  return (
    <article className={cn(
      "participant-tile relative min-h-0 min-w-0 overflow-hidden rounded-[4px] border border-transparent bg-tile transition-[border-color,box-shadow] duration-200",
      active && "is-speaking border-agora/80 shadow-[0_0_0_1px_rgba(0,194,255,0.35),0_0_24px_rgba(0,194,255,0.12)]",
      className
    )}>
      {children}
      <div className="participant-label absolute inset-x-2 bottom-2 flex min-h-7 items-center justify-between gap-3 rounded-[3px] bg-room/80 px-2.5 text-[11px] backdrop-blur">
        <span className="truncate">{label}</span>
        <span className={muted ? "text-meeting-muted" : "text-presence"} aria-label={muted ? "Muted" : "Microphone on"}>{muted ? <MicOff size={15} /> : <Mic size={15} />}</span>
      </div>
    </article>
  );
}

function PresentingBadge() {
  return <span className="absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1.5 rounded-[3px] bg-agora px-2 py-1 font-mono text-[9px] font-bold uppercase text-[#04151b] shadow-lg"><MonitorUp size={13} />Presenting</span>;
}

function ParticipantPlaceholder({ label }: { label: string }) {
  return (
    <div className="participant-placeholder absolute inset-0 flex flex-col items-center justify-center gap-3 bg-tile-deep text-meeting-muted">
      <div className="flex size-[72px] items-center justify-center rounded-full bg-panel-hover text-2xl font-bold text-meeting-soft max-sm:size-14 max-sm:text-xl">{initials(label)}</div>
      <CameraOff size={16} aria-hidden="true" />
    </div>
  );
}

function TrackPlayer({ contain = false, track }: { contain?: boolean; track: PlayableVideoTrack }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    track.play(ref.current);
    return () => track.stop();
  }, [track]);
  return <div className={cn("video-surface absolute inset-0 [&>div]:size-full [&_video]:size-full [&_video]:object-cover", contain && "contain [&_video]:object-contain")} ref={ref} />;
}

function RemoteAudioPlayer({ user }: { user: IAgoraRTCRemoteUser }) {
  useEffect(() => { if (user.audioTrack) user.audioTrack.play(); }, [user.audioTrack]);
  return null;
}

function VoiceBars({ active }: { active: boolean }) {
  return (
    <span className="voice-bars flex h-8 items-center gap-[3px]">
      {Array.from({ length: 7 }).map((_, index) => <i className={cn("block h-2 w-[3px] rounded-[2px] bg-agora", active && "animate-voice-level", active && (index === 1 || index === 5) && "[animation-delay:120ms]", active && (index === 2 || index === 4) && "[animation-delay:240ms]", active && index === 3 && "[animation-delay:360ms]")} key={index} />)}
    </span>
  );
}

function aiDisplayStatus(status: AgentStatus) {
  if (status === "speaking") return { label: "Speaking", description: "Answering the room" } as const;
  if (status === "thinking") return { label: "Thinking", description: "Working on a response" } as const;
  if (status === "standby" || status === "focused") return { label: "Listening", description: `Say “${copilotWakeWord}” to talk` } as const;
  return { label: "Joining", description: "Connecting to the meeting" } as const;
}

function initials(name: string) {
  return name.replace(/\(You\)/, "").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}
