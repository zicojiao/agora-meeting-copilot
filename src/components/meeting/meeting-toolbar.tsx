"use client";

import {
  Bot,
  Camera,
  CameraOff,
  Captions,
  Columns3,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  NotebookTabs,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  SmilePlus,
  UsersRound
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { meetingReactions } from "@/hooks/use-meeting-social";
import type { AgentStatus } from "@/lib/meeting-api";
import { copilotName } from "@/lib/product";
import { cn } from "@/lib/utils";
import type { MeetingPanel } from "./types";

export function MeetingToolbar({
  activePanel,
  aiPresent,
  aiStatus,
  audioMuted,
  canInviteCopilot,
  screenSharing,
  unreadChat,
  videoMuted,
  onInviteCopilot,
  onLeave,
  onReact,
  onToggleAudio,
  onToggleBoard,
  onToggleChat,
  onToggleNotes,
  onTogglePeople,
  onToggleTranscript,
  onToggleScreen,
  onToggleVideo
}: {
  activePanel: MeetingPanel;
  aiPresent: boolean;
  aiStatus: AgentStatus;
  audioMuted: boolean;
  canInviteCopilot: boolean;
  screenSharing: boolean;
  unreadChat: number;
  videoMuted: boolean;
  onInviteCopilot: () => void;
  onLeave: () => void;
  onReact: (emoji: string) => void;
  onToggleAudio: () => void;
  onToggleBoard: () => void;
  onToggleChat: () => void;
  onToggleNotes: () => void;
  onTogglePeople: () => void;
  onToggleTranscript: () => void;
  onToggleScreen: () => void;
  onToggleVideo: () => void;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const react = (emoji: string) => {
    onReact(emoji);
    setReactionOpen(false);
  };

  return (
    <div
      aria-label="Meeting controls"
      className="toolbar-row relative grid min-w-0 grid-cols-[minmax(180px,1fr)_auto_minmax(220px,1fr)] items-center gap-4 border-t border-line bg-room-deep/95 px-4 py-2 backdrop-blur-xl max-[900px]:flex max-[900px]:justify-center max-sm:px-2 max-sm:py-1.5 [@media(max-height:560px)_and_(orientation:landscape)]:py-1"
      role="toolbar"
    >
      <div className="flex min-w-0 items-center justify-start max-[900px]:hidden">
        {aiPresent ? (
          <div className="inline-flex max-w-full items-center gap-2.5 text-left">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-agora/10 text-agora ring-1 ring-inset ring-agora/25"><Bot size={17} /></span>
            <span className="min-w-0">
              <strong className="block truncate text-xs font-semibold">{copilotName}</strong>
              <small className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase text-meeting-muted"><i className="size-1.5 rounded-full bg-presence" />{copilotToolbarStatus(aiStatus)}</small>
            </span>
          </div>
        ) : canInviteCopilot ? (
          <Button className="h-10 px-3.5 shadow-[0_8px_24px_rgba(0,194,255,0.1)]" onClick={onInviteCopilot} variant="active"><Bot size={17} /><span className="text-xs">Invite {copilotName}</span></Button>
        ) : null}
      </div>

      <div className="meeting-toolbar flex max-w-full items-start justify-center gap-1.5 max-sm:gap-1">
        <ControlButton icon={audioMuted ? <MicOff /> : <Mic />} label={audioMuted ? "Unmute" : "Mute"} live={!audioMuted} onClick={onToggleAudio} pressed={!audioMuted} />
        <ControlButton icon={videoMuted ? <CameraOff /> : <Camera />} label={videoMuted ? "Start video" : "Stop video"} live={!videoMuted} onClick={onToggleVideo} pressed={!videoMuted} />
        <div className="relative">
          <ControlButton active={reactionOpen} icon={<SmilePlus />} label="React" onClick={() => { setReactionOpen((open) => !open); setMoreOpen(false); }} pressed={reactionOpen} />
          {reactionOpen ? <ReactionPicker onReact={react} /> : null}
        </div>
        <ControlButton
          className="screen-control max-[900px]:hidden"
          icon={screenSharing ? <ScreenShareOff /> : <ScreenShare />}
          label={screenSharing ? "Stop sharing" : "Share screen"}
          live={screenSharing}
          onClick={onToggleScreen}
          pressed={screenSharing}
        />
        <span className="mx-0.5 mt-1 h-9 w-px bg-line max-[900px]:hidden" />
        <ControlButton danger icon={<PhoneOff />} label="Leave" onClick={onLeave} />
        <div className="relative hidden max-[900px]:block">
          <ControlButton active={moreOpen} icon={<MoreHorizontal />} label="More" onClick={() => { setMoreOpen((open) => !open); setReactionOpen(false); }} pressed={moreOpen} />
          {moreOpen ? (
            <div className="absolute bottom-[calc(100%+10px)] right-0 z-60 grid w-52 overflow-hidden rounded-[4px] border border-line-strong bg-panel p-1.5 shadow-2xl">
              <MenuButton icon={screenSharing ? <ScreenShareOff /> : <ScreenShare />} label={screenSharing ? "Stop sharing" : "Share screen"} onClick={() => { onToggleScreen(); setMoreOpen(false); }} danger={screenSharing} />
              <MenuButton icon={<Captions />} label="Transcript" onClick={() => { onToggleTranscript(); setMoreOpen(false); }} selected={activePanel === "transcript"} />
              <MenuButton icon={<NotebookTabs />} label="Notes" onClick={() => { onToggleNotes(); setMoreOpen(false); }} selected={activePanel === "notes"} />
              <MenuButton icon={<Columns3 />} label="Board" onClick={() => { onToggleBoard(); setMoreOpen(false); }} selected={activePanel === "board"} />
              <MenuButton badge={unreadChat} icon={<MessageSquare />} label="Chat" onClick={() => { onToggleChat(); setMoreOpen(false); }} selected={activePanel === "chat"} />
              <MenuButton icon={<UsersRound />} label="People" onClick={() => { onTogglePeople(); setMoreOpen(false); }} selected={activePanel === "people"} />
              {!aiPresent && canInviteCopilot ? <><span className="my-1 h-px bg-line" /><MenuButton icon={<Bot />} label={`Invite ${copilotName}`} onClick={() => { onInviteCopilot(); setMoreOpen(false); }} /></> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="meeting-panel-switcher flex min-w-0 items-start justify-end gap-0.5 max-[900px]:hidden">
        <PanelButton icon={<Captions />} label="Transcript" onClick={onToggleTranscript} selected={activePanel === "transcript"} />
        <PanelButton icon={<NotebookTabs />} label="Notes" onClick={onToggleNotes} selected={activePanel === "notes"} />
        <PanelButton icon={<Columns3 />} label="Board" onClick={onToggleBoard} selected={activePanel === "board"} />
        <PanelButton badge={unreadChat} icon={<MessageSquare />} label="Chat" onClick={onToggleChat} selected={activePanel === "chat"} />
        <PanelButton icon={<UsersRound />} label="People" onClick={onTogglePeople} selected={activePanel === "people"} />
      </div>
    </div>
  );
}

function ControlButton({ active = false, className, danger = false, icon, label, live = false, onClick, pressed = false }: {
  active?: boolean;
  className?: string;
  danger?: boolean;
  icon: React.ReactNode;
  label: string;
  live?: boolean;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <div className={cn("toolbar-control flex min-w-[52px] flex-col items-center gap-1 max-sm:min-w-10 max-sm:gap-0", className)}>
      <Tooltip label={label}>
        <button
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            "relative flex size-11 items-center justify-center rounded-full bg-panel-raised text-meeting-soft shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] transition duration-150 hover:-translate-y-0.5 hover:bg-panel-hover hover:text-meeting focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agora/50 focus-visible:ring-offset-2 focus-visible:ring-offset-room-deep max-sm:size-10 [&_svg]:size-[19px]",
            active && "bg-agora/15 text-agora shadow-[inset_0_0_0_1px_rgba(0,194,255,0.4)] hover:bg-agora/20 hover:text-agora",
            live && "bg-danger/12 text-danger shadow-[inset_0_0_0_1px_rgba(239,91,91,0.35)] hover:bg-danger/18 hover:text-danger",
            danger && "size-12 bg-danger text-white shadow-none hover:bg-[#ff6969] hover:text-white max-sm:size-10"
          )}
          onClick={onClick}
          title={label}
          type="button"
        >
          <span className="flex" aria-hidden="true">{icon}</span>
          {live ? <i className="absolute right-0.5 top-0.5 size-2 rounded-full border-2 border-room-deep bg-danger" aria-hidden="true" /> : null}
        </button>
      </Tooltip>
      <small className={cn("max-w-[68px] truncate whitespace-nowrap text-[10px] leading-none text-meeting-muted max-sm:hidden", (active || live) && "text-meeting-soft", danger && "text-danger")}>{label}</small>
    </div>
  );
}

function PanelButton({ badge = 0, icon, label, onClick, selected = false }: {
  badge?: number;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <div className="flex min-w-[50px] flex-col items-center gap-1">
      <Tooltip label={label}>
        <button
          aria-label={label}
          aria-pressed={selected}
          className={cn(
            "relative flex size-10 items-center justify-center rounded-full border text-meeting-muted transition duration-150 hover:border-line-strong hover:bg-panel-raised hover:text-meeting focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agora/50",
            selected ? "border-agora/45 bg-agora/12 text-agora" : "border-line bg-panel-raised/45"
          )}
          onClick={onClick}
          title={label}
          type="button"
        >
          <span aria-hidden="true" className="flex [&_svg]:size-[18px]">{icon}</span>
          {badge > 0 ? <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 font-mono text-[8px] leading-4 text-white">{badge > 9 ? "9+" : badge}</span> : null}
        </button>
      </Tooltip>
      <small className={cn("max-w-[64px] truncate text-[9px] leading-none text-meeting-muted", selected && "text-agora")}>{label}</small>
    </div>
  );
}

function MenuButton({ badge = 0, danger = false, icon, label, onClick, selected = false }: {
  badge?: number;
  danger?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button className={cn("flex h-10 items-center gap-3 rounded-[3px] px-3 text-left text-xs text-meeting-soft hover:bg-panel-raised", selected && "bg-agora/10 text-agora", danger && "text-danger")} onClick={onClick} type="button">
      <span className="[&_svg]:size-4">{icon}</span><span className="flex-1">{label}</span>{badge > 0 ? <span className="rounded-full bg-danger px-1.5 py-0.5 font-mono text-[8px] text-white">{badge > 9 ? "9+" : badge}</span> : null}
    </button>
  );
}

function ReactionPicker({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div aria-label="Choose a reaction" className="absolute bottom-[calc(100%+10px)] left-1/2 z-60 flex -translate-x-1/2 gap-0.5 rounded-[4px] border border-line-strong bg-panel p-1.5 shadow-2xl max-sm:fixed max-sm:bottom-[calc(76px+env(safe-area-inset-bottom))] max-sm:left-3 max-sm:right-3 max-sm:translate-x-0 max-sm:justify-between" role="menu">
      {meetingReactions.map((emoji) => <button aria-label={`React ${emoji}`} className="flex size-9 items-center justify-center rounded-[3px] text-lg transition hover:bg-panel-raised hover:scale-110" key={emoji} onClick={() => onReact(emoji)} role="menuitem" type="button">{emoji}</button>)}
    </div>
  );
}

function copilotToolbarStatus(status: AgentStatus) {
  if (status === "speaking") return "Speaking";
  if (status === "thinking") return "Thinking";
  if (status === "joining" || status === "recovering") return "Joining";
  return "Listening";
}
