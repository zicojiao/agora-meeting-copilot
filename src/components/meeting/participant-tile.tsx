"use client";

import type { IAgoraRTCRemoteUser, ILocalVideoTrack } from "agora-rtc-sdk-ng";
import { BotOff, CameraOff, Mic, MicOff, MonitorUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { AgentStatus } from "@/lib/meeting-api";
import { copilotName, copilotWakeWord } from "@/lib/product";
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

export function AiParticipantTile({ canManage, onRemove, status }: { canManage: boolean; onRemove: () => void; status: AgentStatus }) {
  const displayStatus = aiDisplayStatus(status);
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
      </div>
      {canManage ? (
        <div className="absolute right-2.5 top-2.5 z-20">
          <Tooltip label={`Remove ${copilotName}`}>
            <Button
              aria-label={`Remove ${copilotName}`}
              className="rounded-[3px] border-line bg-room/75 text-meeting-muted shadow-lg backdrop-blur hover:border-danger/45 hover:bg-danger/10 hover:text-danger"
              onClick={onRemove}
              size="icon-sm"
              title={`Remove ${copilotName}`}
              variant="secondary"
            >
              <BotOff size={17} />
            </Button>
          </Tooltip>
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
