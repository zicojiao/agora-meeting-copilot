"use client";

import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  ILocalAudioTrack,
  ILocalVideoTrack,
  IMicrophoneAudioTrack
} from "agora-rtc-sdk-ng";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JoinConfig } from "@/components/meeting/types";
import { isScreenShareCancellation, screenShareErrorMessage } from "@/lib/agora-errors";
import { copilotName } from "@/lib/product";
import { issueMediaToken } from "@/lib/meeting-api";

export type RtmMessageEvent = {
  channelName?: string;
  message: string | Uint8Array;
  publisher: string;
};

export type RtmClientLike = {
  addEventListener(event: string, listener: (event: never) => void): void;
  removeEventListener(event: string, listener: (event: never) => void): void;
  removeAllListeners(): void;
  login(options: { token: string }): Promise<unknown>;
  logout(): Promise<unknown>;
  subscribe(channel: string, options: Record<string, boolean>): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  publish(channel: string, message: string | Uint8Array, options?: { channelType?: string; customType?: string }): Promise<unknown>;
};

async function loadAgoraRTC() {
  const mod = await import("agora-rtc-sdk-ng");
  return mod.default;
}

async function loadAgoraRTM() {
  const mod = await import("agora-rtm");
  return mod.default;
}

export function useAgoraRoom(config: JoinConfig) {
  const session = config.session!;
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const screenClientRef = useRef<IAgoraRTCClient | null>(null);
  const rtmClientRef = useRef<RtmClientLike | null>(null);
  const teardownRef = useRef<Promise<void>>(Promise.resolve());
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const localVideoRef = useRef<ICameraVideoTrack | null>(null);
  const localScreenRef = useRef<ILocalVideoTrack | null>(null);
  const localScreenAudioRef = useRef<ILocalAudioTrack | null>(null);
  const localScreenUidRef = useRef<number | null>(null);
  const speakerDecayRef = useRef<number | null>(null);

  const [localVideoTrack, setLocalVideoTrack] = useState<ICameraVideoTrack | null>(null);
  const [localScreenTrack, setLocalScreenTrack] = useState<ILocalVideoTrack | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
  const [screenShareOwners, setScreenShareOwners] = useState<Record<string, string>>({});
  const [localScreenUid, setLocalScreenUid] = useState<number | null>(null);
  const [activeSpeakerUids, setActiveSpeakerUids] = useState<Set<string>>(new Set());
  const [rtmClient, setRtmClient] = useState<RtmClientLike | null>(null);
  const [audioMuted, setAudioMuted] = useState(!config.micOn);
  const [videoMuted, setVideoMuted] = useState(!config.cameraOn);
  const [connectionState, setConnectionState] = useState("joining");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const join = async () => {
      try {
        await teardownRef.current;
        if (cancelled) return;
        const [AgoraRTC, AgoraRTM] = await Promise.all([loadAgoraRTC(), loadAgoraRTM()]);
        AgoraRTC.setLogLevel(2);
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;

        const syncRemoteUsers = () => setRemoteUsers([...client.remoteUsers]);
        client.on("connection-state-change", (state) => { if (!cancelled) setConnectionState(String(state).toLowerCase()); });
        client.on("user-joined", syncRemoteUsers);
        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "audio" && user.audioTrack) user.audioTrack.play();
          syncRemoteUsers();
        });
        client.on("user-unpublished", syncRemoteUsers);
        client.on("user-left", syncRemoteUsers);
        client.on("volume-indicator", (volumes) => {
          const active = new Set(volumes
            .filter((volume) => volume.level >= 25)
            .map((volume) => String(volume.uid) === "0" ? String(session.rtcUid) : String(volume.uid)));
          if (!active.size) return;
          setActiveSpeakerUids(active);
          if (speakerDecayRef.current) window.clearTimeout(speakerDecayRef.current);
          speakerDecayRef.current = window.setTimeout(() => setActiveSpeakerUids(new Set()), 1_800);
        });

        await client.join(session.appId, session.channel, session.rtcToken, session.rtcUid);
        if (cancelled) { await client.leave().catch(() => undefined); return; }
        client.enableAudioVolumeIndicator();

        const rtm = new AgoraRTM.RTM(session.appId, String(session.rtcUid), { useStringUserId: true }) as RtmClientLike;
        rtmClientRef.current = rtm;
        const handleProfile = (incoming: RtmMessageEvent) => {
          try {
            const text = typeof incoming.message === "string" ? incoming.message : new TextDecoder().decode(incoming.message);
            const payload = JSON.parse(text) as { type?: string; uid?: string | number; name?: string; action?: string; screenUid?: string | number };
            if (payload.type === "participant.profile" && payload.uid && payload.name) {
              setParticipantNames((names) => ({ ...names, [String(payload.uid)]: payload.name! }));
            }
            if (payload.type === "meeting.screen-share" && payload.screenUid) {
              const screenUid = String(payload.screenUid);
              setScreenShareOwners((owners) => {
                if (payload.action === "stopped") {
                  const next = { ...owners };
                  delete next[screenUid];
                  return next;
                }
                return { ...owners, [screenUid]: payload.name || "Participant" };
              });
            }
          } catch {
            // Transcript and agent-state payloads are consumed by the transcript hook.
          }
        };
        rtm.addEventListener("message", handleProfile as (event: never) => void);
        await rtm.login({ token: session.rtmToken });
        await rtm.subscribe(session.channel, { beQuiet: true, withMessage: true, withPresence: false, withMetadata: false, withLock: false });
        await rtm.publish(session.channel, JSON.stringify({ type: "participant.profile", uid: session.rtcUid, name: config.displayName, role: session.role }));
        if (!cancelled) {
          setParticipantNames((names) => ({ ...names, [String(session.rtcUid)]: config.displayName, "900001": copilotName }));
          setRtmClient(rtm);
        }

        const tracks: Array<IMicrophoneAudioTrack | ICameraVideoTrack> = [];
        if (config.micOn) {
          const audioTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: "music_standard" });
          localAudioRef.current = audioTrack;
          tracks.push(audioTrack);
        }
        if (config.cameraOn) {
          const videoTrack = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "720p_3" });
          localVideoRef.current = videoTrack;
          setLocalVideoTrack(videoTrack);
          tracks.push(videoTrack);
        }
        if (cancelled) {
          tracks.forEach(cleanupTrack);
          await client.leave().catch(() => undefined);
          return;
        }
        if (tracks.length) await client.publish(tracks);
        setConnectionState("connected");
        setAudioMuted(!config.micOn);
        setVideoMuted(!config.cameraOn);
      } catch (caught) {
        console.error(caught);
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Failed to join Agora room.");
          setConnectionState("failed");
        }
      }
    };

    void join();
    return () => {
      cancelled = true;
      const audioTrack = localAudioRef.current;
      const videoTrack = localVideoRef.current;
      const screenTrack = localScreenRef.current;
      const screenAudioTrack = localScreenAudioRef.current;
      const rtm = rtmClientRef.current;
      const client = clientRef.current;
      const screenClient = screenClientRef.current;
      teardownRef.current = (async () => {
        cleanupTrack(audioTrack);
        cleanupTrack(videoTrack);
        cleanupTrack(screenTrack);
        cleanupTrack(screenAudioTrack);
        if (rtm) {
          rtm.removeAllListeners();
          await rtm.unsubscribe(session.channel).catch(() => undefined);
          await rtm.logout().catch(() => undefined);
        }
        await client?.leave().catch(() => undefined);
        await screenClient?.leave().catch(() => undefined);
      })();
      localAudioRef.current = null;
      localVideoRef.current = null;
      localScreenRef.current = null;
      localScreenAudioRef.current = null;
      localScreenUidRef.current = null;
      if (speakerDecayRef.current) window.clearTimeout(speakerDecayRef.current);
      rtmClientRef.current = null;
      setRtmClient(null);
      clientRef.current = null;
      screenClientRef.current = null;
    };
  }, [config.roomId, config.displayName, config.micOn, config.cameraOn, session]);

  const toggleAudio = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      if (!localAudioRef.current) {
        const AgoraRTC = await loadAgoraRTC();
        const track = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: "music_standard" });
        localAudioRef.current = track;
        await client.publish(track);
        setAudioMuted(false);
        return;
      }
      const nextMuted = !audioMuted;
      await localAudioRef.current.setEnabled(!nextMuted);
      setAudioMuted(nextMuted);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to change microphone state."); }
  }, [audioMuted]);

  const toggleVideo = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      if (!localVideoRef.current) {
        const AgoraRTC = await loadAgoraRTC();
        const track = await AgoraRTC.createCameraVideoTrack({ encoderConfig: "720p_3" });
        localVideoRef.current = track;
        setLocalVideoTrack(track);
        await client.publish(track);
        setVideoMuted(false);
        return;
      }
      const nextMuted = !videoMuted;
      await localVideoRef.current.setEnabled(!nextMuted);
      setVideoMuted(nextMuted);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to change camera state."); }
  }, [videoMuted]);

  const stopScreenShare = useCallback(async () => {
    const screenClient = screenClientRef.current;
    const screenTrack = localScreenRef.current;
    const screenAudioTrack = localScreenAudioRef.current;
    const screenUid = localScreenUidRef.current;
    const tracks = [screenTrack, screenAudioTrack].filter(Boolean) as Array<ILocalVideoTrack | ILocalAudioTrack>;
    if (screenClient && tracks.length) await screenClient.unpublish(tracks).catch(() => undefined);
    cleanupTrack(screenTrack);
    cleanupTrack(screenAudioTrack);
    await screenClient?.leave().catch(() => undefined);
    if (screenUid) {
      setScreenShareOwners((owners) => {
        const next = { ...owners };
        delete next[String(screenUid)];
        return next;
      });
      await rtmClientRef.current?.publish(session.channel, JSON.stringify({
        type: "meeting.screen-share",
        action: "stopped",
        screenUid,
        uid: session.rtcUid,
        name: config.displayName
      })).catch(() => undefined);
    }
    screenClientRef.current = null;
    localScreenRef.current = null;
    localScreenAudioRef.current = null;
    localScreenUidRef.current = null;
    setLocalScreenTrack(null);
    setLocalScreenUid(null);
  }, [config.displayName, session.channel, session.rtcUid]);

  const toggleScreenShare = useCallback(async () => {
    if (localScreenRef.current) { await stopScreenShare(); return; }
    setError(null);
    try {
      const AgoraRTC = await loadAgoraRTC();
      const screenClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      screenClientRef.current = screenClient;
      const credential = await issueMediaToken(config.roomId, session.capability);
      localScreenUidRef.current = credential.uid;
      setLocalScreenUid(credential.uid);
      setScreenShareOwners((owners) => ({ ...owners, [String(credential.uid)]: config.displayName }));
      await rtmClientRef.current?.publish(session.channel, JSON.stringify({
        type: "meeting.screen-share",
        action: "started",
        screenUid: credential.uid,
        uid: session.rtcUid,
        name: config.displayName
      })).catch(() => undefined);
      await screenClient.join(credential.appId, credential.channel, credential.token, credential.uid);
      const result = await AgoraRTC.createScreenVideoTrack({ encoderConfig: "1080p_1" }, "auto");
      const screenTrack = Array.isArray(result) ? result[0] : result;
      const screenAudioTrack = Array.isArray(result) ? result[1] : null;
      localScreenRef.current = screenTrack;
      localScreenAudioRef.current = screenAudioTrack;
      screenTrack.on("track-ended", () => void stopScreenShare());
      await screenClient.publish([screenTrack, ...(screenAudioTrack ? [screenAudioTrack] : [])]);
      setLocalScreenTrack(screenTrack);
    } catch (caught) {
      await stopScreenShare();
      if (isScreenShareCancellation(caught)) return;
      console.error(caught);
      setError(screenShareErrorMessage(caught));
    }
  }, [config.displayName, config.roomId, session.capability, session.channel, session.rtcUid, stopScreenShare]);

  return {
    uid: session.rtcUid,
    rtcClient: clientRef.current,
    rtmClient,
    localVideoTrack,
    localScreenTrack,
    remoteUsers,
    participantNames,
    screenShareOwners,
    localScreenUid,
    activeSpeakerUids,
    audioMuted,
    videoMuted,
    connectionState,
    error,
    clearError: () => setError(null),
    toggleAudio,
    toggleVideo,
    toggleScreenShare
  };
}

function cleanupTrack(track: ILocalAudioTrack | ILocalVideoTrack | null) {
  if (!track) return;
  track.stop();
  track.close();
}
