"use client";

import { Bot, BotOff, Copy, Link2, LoaderCircle, LogOut, PhoneOff, Share2, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogBackdrop, DialogSurface } from "@/components/ui/dialog";
import { useAgoraRoom } from "@/hooks/use-agora-room";
import { useMeetingExitGuard } from "@/hooks/use-meeting-exit-guard";
import { useMeetingCopilot } from "@/hooks/use-meeting-copilot";
import { useMeetingSocial } from "@/hooks/use-meeting-social";
import { useMeetingTranscription } from "@/hooks/use-meeting-transcription";
import { useParticipantSounds } from "@/hooks/use-participant-sounds";
import { endMeetingForEveryone, leaveMeeting } from "@/lib/meeting-api";
import { meetingPath } from "@/lib/meeting-routes";
import { resolveParticipantProfile } from "@/lib/participant-profile";
import { copilotName, copilotWakeWord } from "@/lib/product";
import { buildUnifiedTranscriptEntries, type UnifiedTranscriptEntry } from "@/lib/unified-transcript";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { BoardPanel } from "./board-panel";
import { ChatPanel } from "./chat-panel";
import { MeetingToolbar } from "./meeting-toolbar";
import { MeetingSidePanel } from "./meeting-side-panel";
import { NotesPanel } from "./notes-panel";
import { AiParticipantTile, LocalParticipantTile, RemoteParticipantTile, RemoteScreenShareTile, ScreenShareTile } from "./participant-tile";
import { PeoplePanel } from "./people-panel";
import { ReactionLayer } from "./reaction-layer";
import { TranscriptPanel } from "./transcript-panel";
import type { JoinConfig, MeetingPanel } from "./types";

export function MeetingRoom({ config, onEnded, onLeave }: { config: JoinConfig; onEnded: (roomId: string) => void; onLeave: () => void }) {
  const session = config.session!;
  const room = useAgoraRoom(config);
  const copilot = useMeetingCopilot({ roomId: config.roomId, session, rtcClient: room.rtcClient, rtmClient: room.rtmClient, participantNames: room.participantNames });
  const transcriptParticipantNames = useMemo(
    () => Object.fromEntries((copilot.state?.participants ?? []).map((participant) => [participant.rtcUid, participant.displayName])),
    [copilot.state?.participants]
  );
  const transcription = useMeetingTranscription({
    roomId: config.roomId,
    roomCreatedAt: copilot.state?.room.createdAt,
    session,
    rtcClient: room.rtcClient,
    connectionState: room.connectionState,
    transcription: copilot.state?.transcription,
    participantNames: transcriptParticipantNames
  });
  const [activePanel, setActivePanel] = useState<MeetingPanel>(null);
  const [copilotConsentOpen, setCopilotConsentOpen] = useState(false);
  const [removeCopilotOpen, setRemoveCopilotOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endingPhase, setEndingPhase] = useState("Finalizing transcript");
  const [leaving, setLeaving] = useState(false);
  const [removingCopilot, setRemovingCopilot] = useState(false);
  const [roomLink, setRoomLink] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const endedRef = useRef(false);
  const elapsed = useMeetingTimer();
  const isHost = session.role === "host";
  const sttPublisherUid = copilot.state?.transcription?.publisherUid || transcription.transcription?.publisherUid || "900003";
  const remoteScreenUsers = room.remoteUsers.filter((user) => isScreenShareUid(user.uid) && String(user.uid) !== String(room.localScreenUid));
  const humanRemoteUsers = room.remoteUsers.filter((user) => !isScreenShareUid(user.uid) && !new Set(["900001", "900002", sttPublisherUid]).has(String(user.uid)));
  const remoteParticipantProfiles = Object.fromEntries(humanRemoteUsers.map((user) => {
    const uid = String(user.uid);
    return [uid, resolveParticipantProfile(uid, room.participantNames, copilot.state?.participants ?? [])];
  }));
  const visualStatus = room.activeSpeakerUids.has("900001") && copilot.status !== "offline" ? "speaking" : copilot.status;
  const aiPresent = visualStatus !== "offline" && visualStatus !== "error";
  const participantCount = 1 + humanRemoteUsers.length + (aiPresent ? 1 : 0);
  const tileCount = 1 + humanRemoteUsers.length + remoteScreenUsers.length + (aiPresent ? 1 : 0) + (room.localScreenTrack ? 1 : 0);
  const hasScreenFocus = Boolean(room.localScreenTrack || remoteScreenUsers.length);
  const transcriptEntries = useMemo(() => buildUnifiedTranscriptEntries(
    copilot.state?.transcriptSegments ?? [],
    copilot.state?.copilotTurns ?? [],
    copilot.state?.room.createdAt
  ), [copilot.state?.copilotTurns, copilot.state?.room.createdAt, copilot.state?.transcriptSegments]);
  const liveCaption = useLiveCaption(transcriptEntries, transcription.partialSegments);
  const social = useMeetingSocial({
    channel: session.channel,
    displayName: config.displayName,
    isChatOpen: activePanel === "chat",
    rtmClient: room.rtmClient,
    uid: session.rtcUid
  });
  useParticipantSounds(humanRemoteUsers.map((user) => String(user.uid)), room.connectionState);
  const disarmExitGuard = useMeetingExitGuard(() => {
    void leaveMeeting(config.roomId, session.capability, true).catch(() => undefined);
  });

  useOperationalErrorToast(room.error, room.clearError, "rtc-operation-error");
  useOperationalErrorToast(copilot.error, copilot.clearError, "copilot-operation-error", copilot.error?.includes("reconnecting") ? "warning" : "error");
  useOperationalErrorToast(transcription.error, transcription.clearError, "transcription-operation-error");

  const notifyEnded = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    disarmExitGuard();
    onEnded(config.roomId);
  }, [config.roomId, disarmExitGuard, onEnded]);

  useEffect(() => {
    setRoomLink(new URL(meetingPath(config.roomId), window.location.origin).toString());
  }, [config.roomId]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1101px)").matches) {
      setActivePanel((panel) => panel ?? "transcript");
    }
  }, []);

  useEffect(() => {
    if (!ending) return;
    setEndingPhase("Finalizing transcript");
    const notesTimer = window.setTimeout(() => setEndingPhase("Creating meeting notes"), 2_200);
    const downloadTimer = window.setTimeout(() => setEndingPhase("Preparing downloads"), 5_000);
    return () => { window.clearTimeout(notesTimer); window.clearTimeout(downloadTimer); };
  }, [ending]);

  useEffect(() => {
    if (!copilot.state?.room.lastError) return;
    toast.error(copilot.state.room.lastError, { id: "copilot-room-error" });
  }, [copilot.state?.room.lastError]);

  useEffect(() => {
    if (copilot.state?.room.status === "ended") notifyEnded();
  }, [copilot.state?.room.status, notifyEnded]);

  const copyRoomLink = async () => {
    const link = roomLink || new URL(meetingPath(config.roomId), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Meeting link copied", { id: "meeting-link-copied", duration: 2_500 });
    } catch {
      toast.error("Could not copy the meeting link", {
        description: "Check clipboard permission and try again.",
        id: "meeting-link-copy-error"
      });
    }
  };

  const selectPanel = (panel: Exclude<MeetingPanel, null>) => {
    setActivePanel(panel);
  };

  const shareRoomLink = async () => {
    if (!navigator.share) {
      await copyRoomLink();
      return;
    }
    try {
      await navigator.share({ title: "Agora Meeting Copilot", text: `Join ${config.roomId}`, url: roomLink });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      toast.error("Could not open system sharing", { id: "meeting-share-error" });
    }
  };

  const requestCopilotInvite = () => {
    if (!isHost || aiPresent) return;
    setCopilotConsentOpen(true);
  };

  const confirmCopilotInvite = () => {
    setCopilotConsentOpen(false);
    void copilot.start().catch(() => undefined);
  };

  const confirmCopilotRemoval = async () => {
    if (removingCopilot) return;
    setRemovingCopilot(true);
    try {
      await copilot.stop();
      setRemoveCopilotOpen(false);
    } catch {
      // The Copilot hook presents the request error through the shared toast flow.
    } finally {
      setRemovingCopilot(false);
    }
  };

  const requestLeave = () => {
    if (isHost) setLeaveDialogOpen(true);
    else void leaveOwnMeeting();
  };

  const leaveOwnMeeting = async () => {
    if (leaving || ending) return;
    setLeaving(true);
    disarmExitGuard();
    await leaveMeeting(config.roomId, session.capability).catch(() => undefined);
    onLeave();
  };

  const endForEveryone = async () => {
    setEnding(true);
    try {
      await endMeetingForEveryone(config.roomId, session.capability);
      setLeaveDialogOpen(false);
      notifyEnded();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The meeting could not be ended.", { id: "end-meeting-error" });
    } finally {
      setEnding(false);
    }
  };

  const gridClass = useMemo(() => participantGridClass(Math.min(tileCount, 6), hasScreenFocus), [hasScreenFocus, tileCount]);

  return (
    <div className="meeting-page grid h-dvh grid-rows-[54px_minmax(0,1fr)_76px] overflow-hidden bg-room text-meeting max-sm:grid-rows-[50px_minmax(0,1fr)_68px] [@media(max-height:560px)_and_(orientation:landscape)]:grid-rows-[44px_minmax(0,1fr)_60px]">
      <header className="meeting-header grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line px-4 max-[820px]:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:gap-2 max-sm:px-2.5">
        <Brand compact hideCopyOnMobile />
        <div className="meeting-identity flex min-w-0 items-center justify-center gap-1.5 max-[820px]:justify-start">
          <strong className="max-w-[280px] truncate font-mono text-xs max-sm:max-w-[150px] max-sm:text-[10px]">{config.roomId}</strong>
          <Button aria-label="Invite people" className="px-2.5" onClick={() => setInviteOpen(true)} size="sm" title="Invite people" variant="ghost">
            <Share2 size={14} /><span className="whitespace-nowrap">Invite</span>
          </Button>
        </div>
        <div className="meeting-meta flex items-center justify-end gap-3 font-mono text-[11px] text-meeting-muted">
          <span className="connection-pill inline-flex items-center gap-1.5 capitalize max-[820px]:hidden"><i className={cn("size-1.5 rounded-full", room.connectionState === "connected" ? "bg-presence" : room.connectionState === "failed" ? "bg-danger" : "bg-warning")} />{room.connectionState}</span>
          <span className="inline-flex items-center gap-1.5"><UsersRound size={15} />{participantCount}</span>
          <time className="max-[820px]:hidden">{elapsed}</time>
        </div>
      </header>

      <div className={cn(
        "meeting-workspace relative grid min-h-0 overflow-hidden",
        activePanel === "board"
          ? "panel-open grid-cols-[minmax(0,1fr)_640px] max-[1100px]:grid-cols-1"
          : activePanel
            ? "panel-open grid-cols-[minmax(0,1fr)_360px] max-[1100px]:grid-cols-1"
            : "grid-cols-1"
      )}>
        <section className="meeting-canvas relative min-h-0 min-w-0 p-2.5 max-sm:p-1.5" aria-label="Meeting participants">
          <div className={gridClass}>
            {room.localScreenTrack ? <ScreenShareTile track={room.localScreenTrack} /> : null}
            {remoteScreenUsers.map((user, index) => <RemoteScreenShareTile focused={!room.localScreenTrack && index === 0} key={`screen-${String(user.uid)}`} name={room.screenShareOwners[String(user.uid)]} user={user} />)}
            <LocalParticipantTile active={room.activeSpeakerUids.has(String(session.rtcUid))} displayName={config.displayName} muted={room.audioMuted} videoMuted={room.videoMuted} videoTrack={room.localVideoTrack} />
            {humanRemoteUsers.map((user) => {
              const uid = String(user.uid);
              return (
                <RemoteParticipantTile
                  active={room.activeSpeakerUids.has(uid)}
                  key={uid}
                  name={remoteParticipantProfiles[uid].displayName}
                  user={user}
                />
              );
            })}
            {aiPresent ? <AiParticipantTile canManage={isHost} onRemove={() => setRemoveCopilotOpen(true)} status={visualStatus} /> : null}
          </div>
          <ReactionLayer reactions={social.reactions} />
          {transcription.captionsOn && liveCaption ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-5 z-20 mx-auto flex max-w-[760px] justify-center max-sm:inset-x-2 max-sm:bottom-3">
              <div className="max-w-full rounded-[3px] border border-white/15 bg-black/75 px-4 py-2.5 text-center shadow-2xl backdrop-blur-sm max-sm:px-3 max-sm:py-2">
                <span className="mr-2 text-[10px] font-semibold text-agora">{liveCaption.speakerName}</span>
                <span className="text-sm leading-relaxed text-white max-sm:text-xs">{liveCaption.text}</span>
              </div>
            </div>
          ) : null}
        </section>

        {activePanel ? (
          <MeetingSidePanel activePanel={activePanel} onClose={() => setActivePanel(null)} onSelect={selectPanel} wide={activePanel === "board"}>
            {activePanel === "transcript" ? (
              <TranscriptPanel
                captionsOn={transcription.captionsOn}
                entries={transcriptEntries}
                onCaptionsChange={transcription.setCaptionsOn}
                selectedSegmentId={selectedSegmentId}
                transcription={copilot.state?.transcription ?? transcription.transcription}
              />
            ) : null}
            {activePanel === "notes" ? (
              <NotesPanel
                notes={copilot.state?.finalNotes ?? copilot.state?.liveNotes}
                onEvidence={(evidence) => { setSelectedSegmentId(evidence.segmentId); setActivePanel("transcript"); }}
              />
            ) : null}
            {activePanel === "people" ? (
              <PeoplePanel
                aiStatus={visualStatus}
                displayName={config.displayName}
                isHost={isHost}
                localMuted={room.audioMuted}
                participantProfiles={remoteParticipantProfiles}
                remoteUsers={humanRemoteUsers}
              />
            ) : null}
            {activePanel === "board" ? <BoardPanel cards={copilot.state?.kanbanCards ?? []} roomId={config.roomId} /> : null}
            {activePanel === "chat" ? <ChatPanel messages={social.messages} onSend={social.sendMessage} /> : null}
          </MeetingSidePanel>
        ) : null}
      </div>

      <MeetingToolbar
        activePanel={activePanel}
        aiPresent={aiPresent}
        aiStatus={visualStatus}
        audioMuted={room.audioMuted}
        canInviteCopilot={isHost && !aiPresent}
        onInviteCopilot={requestCopilotInvite}
        onLeave={requestLeave}
        onReact={(emoji) => void social.sendReaction(emoji).catch(() => undefined)}
        onToggleAudio={() => void room.toggleAudio()}
        onToggleBoard={() => setActivePanel((panel) => panel === "board" ? null : "board")}
        onToggleChat={() => setActivePanel((panel) => panel === "chat" ? null : "chat")}
        onToggleNotes={() => setActivePanel((panel) => panel === "notes" ? null : "notes")}
        onTogglePeople={() => setActivePanel((panel) => panel === "people" ? null : "people")}
        onToggleTranscript={() => setActivePanel((panel) => panel === "transcript" ? null : "transcript")}
        onToggleScreen={() => void room.toggleScreenShare()}
        onToggleVideo={() => void room.toggleVideo()}
        screenSharing={Boolean(room.localScreenTrack)}
        unreadChat={social.unreadCount}
        videoMuted={room.videoMuted}
      />

      {inviteOpen ? (
        <DialogBackdrop onClick={(event) => { if (event.target === event.currentTarget) setInviteOpen(false); }}>
          <DialogSurface aria-labelledby="invite-people-title" aria-modal="true" role="dialog">
            <div className="mb-4 flex size-11 items-center justify-center rounded-[3px] border border-agora/30 bg-agora/10 text-agora"><Share2 size={21} aria-hidden="true" /></div>
            <span className="font-mono text-[9px] font-bold uppercase text-agora">Meeting invite</span>
            <h2 className="mt-1 text-2xl font-semibold" id="invite-people-title">Invite people</h2>
            <p className="mt-2 text-sm leading-relaxed text-meeting-soft">Anyone with this link can join the room from a browser.</p>
            <div className="mt-5 flex items-center gap-2 rounded-[3px] border border-line-strong bg-room-deep p-2">
              <Link2 className="ml-1 shrink-0 text-meeting-muted" size={16} />
              <input aria-label="Meeting link" className="min-w-0 flex-1 bg-transparent px-1 text-xs text-meeting-soft outline-none" readOnly value={roomLink} />
              <Button aria-label="Copy meeting link" onClick={() => void copyRoomLink()} size="icon-sm" title="Copy meeting link" variant="ghost"><Copy size={16} /></Button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-line pt-4">
              <Button onClick={() => setInviteOpen(false)} variant="secondary">Close</Button>
              <Button onClick={() => void shareRoomLink()} variant="primary"><Share2 size={15} />Share invite</Button>
            </div>
          </DialogSurface>
        </DialogBackdrop>
      ) : null}

      {copilotConsentOpen ? (
        <DialogBackdrop>
          <DialogSurface aria-labelledby="ai-consent-title" aria-modal="true" role="dialog">
            <div className="mb-4 flex size-11 items-center justify-center rounded-[3px] border border-agora/30 bg-agora/10 text-agora"><Bot size={22} aria-hidden="true" /></div>
            <div>
              <span className="font-mono text-[9px] font-bold uppercase text-agora">Meeting participant</span>
              <h2 className="mt-1 text-2xl font-semibold" id="ai-consent-title">Invite {copilotName}?</h2>
              <p className="mt-2 text-sm leading-relaxed text-meeting-soft">{copilotName} joins as a visible teammate. Anyone can say “{copilotWakeWord}” to ask a question, request a recap, or assign an action.</p>
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-xs text-meeting-muted"><i className="size-1.5 rounded-full bg-presence" />Visible to everyone in this meeting</div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button autoFocus onClick={() => setCopilotConsentOpen(false)} variant="secondary">Cancel</Button>
              <Button onClick={confirmCopilotInvite} variant="primary"><Bot size={15} />Invite {copilotName}</Button>
            </div>
          </DialogSurface>
        </DialogBackdrop>
      ) : null}

      {removeCopilotOpen ? (
        <DialogBackdrop>
          <DialogSurface aria-labelledby="remove-copilot-title" aria-modal="true" role="dialog">
            <div className="mb-4 flex size-11 items-center justify-center rounded-[3px] border border-danger/30 bg-danger/10 text-danger"><BotOff size={21} aria-hidden="true" /></div>
            <span className="font-mono text-[9px] font-bold uppercase text-danger">Meeting participant</span>
            <h2 className="mt-1 text-xl font-semibold" id="remove-copilot-title">Remove {copilotName}?</h2>
            <p className="mt-2 text-sm leading-relaxed text-meeting-soft">{copilotName} will leave this meeting and stop listening or speaking. The meeting, transcript, notes, and other participants will continue.</p>
            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-line pt-4">
              <Button autoFocus disabled={removingCopilot} onClick={() => setRemoveCopilotOpen(false)} variant="secondary">Cancel</Button>
              <Button disabled={removingCopilot} onClick={() => void confirmCopilotRemoval()} variant="danger">
                {removingCopilot ? <LoaderCircle className="animate-spin" size={15} /> : <BotOff size={15} />}
                {removingCopilot ? "Removing…" : `Remove ${copilotName}`}
              </Button>
            </div>
          </DialogSurface>
        </DialogBackdrop>
      ) : null}

      {leaveDialogOpen ? (
        <DialogBackdrop>
          <DialogSurface aria-labelledby="leave-meeting-title" aria-modal="true" role="dialog">
            <div className="mb-4 flex size-11 items-center justify-center rounded-[3px] border border-danger/30 bg-danger/10 text-danger"><PhoneOff size={21} aria-hidden="true" /></div>
            <h2 className="text-xl font-semibold" id="leave-meeting-title">Leave this meeting?</h2>
            <p className="mt-2 text-sm leading-relaxed text-meeting-soft">Leave on your own, or end the meeting and prepare the final transcript and notes for everyone.</p>
            <div className="mt-5 grid gap-2 border-t border-line pt-4">
              <Button disabled={ending || leaving} onClick={() => void leaveOwnMeeting()} variant="secondary">{leaving ? <LoaderCircle className="animate-spin" size={15} /> : <LogOut size={15} />}{leaving ? "Leaving…" : "Leave meeting"}</Button>
              <Button disabled={ending || leaving} onClick={() => void endForEveryone()} variant="danger">{ending ? <LoaderCircle className="animate-spin" size={15} /> : <PhoneOff size={15} />}{ending ? "Ending meeting…" : "End for everyone"}</Button>
              {ending ? <div className="rounded-[3px] border border-line bg-room-deep px-3 py-2.5 text-xs text-meeting-soft"><span className="inline-flex items-center gap-2"><i className="size-1.5 animate-pulse rounded-full bg-agora" />{endingPhase}</span><p className="mt-1 text-[10px] text-meeting-muted">Keeping the transcript, notes, and downloads together.</p></div> : null}
              <Button disabled={ending || leaving} onClick={() => setLeaveDialogOpen(false)} variant="ghost">Cancel</Button>
            </div>
          </DialogSurface>
        </DialogBackdrop>
      ) : null}
    </div>
  );
}

function isScreenShareUid(uid: string | number) {
  const numeric = Number(uid);
  return Number.isFinite(numeric) && numeric >= 1_000_000;
}

function useLiveCaption(entries: UnifiedTranscriptEntry[], partials: Array<{ speakerUid: string; speakerName: string; text: string }>) {
  const latestPartial = partials.at(-1);
  const latestEntry = entries.at(-1);
  const [recentEntry, setRecentEntry] = useState<UnifiedTranscriptEntry | null>(latestEntry ?? null);
  useEffect(() => {
    if (!latestEntry) return;
    setRecentEntry(latestEntry);
    const timer = window.setTimeout(() => setRecentEntry((current) => current?.id === latestEntry.id ? null : current), 6_000);
    return () => window.clearTimeout(timer);
  }, [latestEntry]);
  if (latestPartial) return { speakerName: latestPartial.speakerName, text: latestPartial.text };
  return recentEntry ? { speakerName: recentEntry.speakerName, text: recentEntry.text } : null;
}

function participantGridClass(count: number, hasFocus: boolean) {
  const base = "participant-grid grid size-full min-h-0 gap-2 max-sm:gap-1.5";
  if (hasFocus) {
    return `${base} has-focus grid-cols-[minmax(0,3.3fr)_minmax(200px,1fr)] grid-rows-3 [&_.focus-tile]:col-start-1 [&_.focus-tile]:row-span-3 max-sm:grid-cols-2 max-sm:grid-rows-[minmax(0,2fr)_minmax(0,1fr)] max-sm:[&_.focus-tile]:col-span-2 max-sm:[&_.focus-tile]:row-span-1`;
  }
  if (count <= 1) return `${base} tiles-1 grid-cols-1`;
  if (count === 2) return `${base} tiles-2 grid-cols-2 max-sm:grid-cols-1 max-sm:grid-rows-2`;
  if (count <= 4) return `${base} tiles-${count} grid-cols-2 grid-rows-2`;
  return `${base} tiles-${count} grid-cols-3 grid-rows-2 max-[820px]:grid-cols-2 max-[820px]:grid-rows-3`;
}

function useOperationalErrorToast(
  error: string | null,
  clearError: () => void,
  id: string,
  variant: "error" | "warning" = "error"
) {
  const clearErrorRef = useRef(clearError);
  clearErrorRef.current = clearError;

  useEffect(() => {
    if (!error) return;
    if (variant === "warning") toast.warning(error, { id });
    else toast.error(error, { id });
    clearErrorRef.current();
  }, [error, id, variant]);
}

function useMeetingTimer() {
  const startedAt = useRef(Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
