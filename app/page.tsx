"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HomeScreen } from "@/components/meeting/home-screen";
import { MeetingRoom } from "@/components/meeting/meeting-room";
import { PrejoinScreen } from "@/components/meeting/prejoin-screen";
import type { AppStep, JoinConfig } from "@/components/meeting/types";
import { createMeeting, getEndedMeetingArtifacts, getRoomState, joinMeeting } from "@/lib/meeting-api";
import { meetingPath, meetingSummaryPath } from "@/lib/meeting-routes";
import { clearMeetingSession, loadMeetingSession, saveMeetingSession } from "@/lib/meeting-session";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";

const emptyJoinConfig: JoinConfig = {
  roomId: "",
  displayName: "",
  micOn: false,
  cameraOn: false
};

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-room" />}>
      <MeetingApp />
    </Suspense>
  );
}

function MeetingApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeRoomId = normalizeRoomCode(searchParams.get("room") || "");
  const [step, setStep] = useState<AppStep>(routeRoomId ? "prejoin" : "home");
  const [joinConfig, setJoinConfig] = useState<JoinConfig>({ ...emptyJoinConfig, roomId: routeRoomId });
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLaunchError(null);

    if (!routeRoomId) {
      setJoinConfig(emptyJoinConfig);
      setStep("home");
      return () => { cancelled = true; };
    }
    if (!isValidRoomCode(routeRoomId)) {
      setJoinConfig(emptyJoinConfig);
      setLaunchError("That meeting link has an invalid room code.");
      setStep("home");
      return () => { cancelled = true; };
    }

    const hostSecret = window.sessionStorage.getItem(`meeting-host:${routeRoomId}`) || undefined;
    const stored = loadMeetingSession(routeRoomId);
    setJoinConfig((current) => ({
      ...current,
      roomId: routeRoomId,
      displayName: current.roomId === routeRoomId ? current.displayName : "",
      hostSecret,
      session: current.roomId === routeRoomId ? current.session : undefined
    }));
    setStep("prejoin");

    const resumeRoom = async () => {
      if (!stored) return;
      try {
        const state = await getRoomState(routeRoomId, stored.session.capability);
        if (cancelled || state.room.status !== "open") return;
        const stillPresent = state.participants.some((participant) => participant.rtcUid === String(stored.session.rtcUid));
        const session = stillPresent ? stored.session : await joinMeeting(routeRoomId, stored.displayName, hostSecret);
        if (!stillPresent) saveMeetingSession(routeRoomId, stored.displayName, session);
        setJoinConfig({ ...emptyJoinConfig, roomId: routeRoomId, displayName: stored.displayName, hostSecret, session });
        setStep("room");
      } catch {
        clearMeetingSession(routeRoomId);
      }
    };
    void resumeRoom();

    const resolveRoom = async () => {
      try {
        await getEndedMeetingArtifacts(routeRoomId);
        if (!cancelled) router.replace(meetingSummaryPath(routeRoomId));
      } catch {
        // Without ended artifacts, keep the room on its active meeting route.
      }
    };
    void resolveRoom();
    return () => { cancelled = true; };
  }, [routeRoomId, router]);

  const createNewMeeting = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const created = await createMeeting();
      window.sessionStorage.setItem(`meeting-host:${created.roomId}`, created.hostSecret);
      setJoinConfig({ ...emptyJoinConfig, roomId: created.roomId, hostSecret: created.hostSecret });
      setStep("prejoin");
      router.push(meetingPath(created.roomId));
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "Could not create the meeting.");
    } finally {
      setLaunching(false);
    }
  };

  const openMeeting = (roomId: string) => {
    const normalizedRoomId = normalizeRoomCode(roomId);
    if (!isValidRoomCode(normalizedRoomId)) {
      setLaunchError("Enter a valid meeting room code.");
      return;
    }
    const hostSecret = window.sessionStorage.getItem(`meeting-host:${normalizedRoomId}`) || undefined;
    setJoinConfig({ ...emptyJoinConfig, roomId: normalizedRoomId, hostSecret });
    setStep("prejoin");
    router.push(meetingPath(normalizedRoomId));
  };

  const enterMeeting = async () => {
    const displayName = joinConfig.displayName.trim();
    if (!displayName) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const session = await joinMeeting(joinConfig.roomId, displayName, joinConfig.hostSecret);
      saveMeetingSession(joinConfig.roomId, displayName, session);
      setJoinConfig((current) => ({ ...current, displayName, session }));
      setStep("room");
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "Could not join the meeting.");
    } finally {
      setLaunching(false);
    }
  };

  const returnHome = () => {
    if (joinConfig.roomId) clearMeetingSession(joinConfig.roomId);
    setLaunchError(null);
    setJoinConfig(emptyJoinConfig);
    setStep("home");
    router.push("/");
  };

  return (
    <div className="min-h-dvh">
      {step === "home" ? (
        <HomeScreen error={launchError} initialRoomId={joinConfig.roomId} loading={launching} onCreate={() => void createNewMeeting()} onJoin={openMeeting} />
      ) : null}
      {step === "prejoin" ? (
        <PrejoinScreen
          error={launchError}
          loading={launching}
          onBack={returnHome}
          onChange={setJoinConfig}
          onJoin={() => void enterMeeting()}
          value={joinConfig}
        />
      ) : null}
      {step === "room" && joinConfig.session ? (
        <MeetingRoom
          config={joinConfig}
          onEnded={(roomId) => {
            setJoinConfig((current) => ({ ...current, session: undefined }));
            router.push(meetingSummaryPath(roomId));
          }}
          onLeave={returnHome}
        />
      ) : null}
    </div>
  );
}
