import type { ParticipantRole, RoomParticipant } from "./meeting-api";
import { copilotName } from "./product";

const copilotRtcUid = "900001";

export type ParticipantProfile = {
  displayName: string;
  role: ParticipantRole;
};

export function resolveParticipantProfile(
  rtcUid: string,
  realtimeNames: Record<string, string>,
  participants: RoomParticipant[]
): ParticipantProfile {
  const participant = participants.find((item) => item.rtcUid === rtcUid);
  const realtimeName = realtimeNames[rtcUid]?.trim();
  const storedName = participant?.displayName.trim();

  return {
    displayName: realtimeName || storedName || "Joining...",
    role: participant?.role ?? "guest"
  };
}

export function resolveTranscriptSpeakerName(
  rtcUid: string,
  participantNames: Record<string, string>
) {
  if (rtcUid === copilotRtcUid) return copilotName;
  return participantNames[rtcUid]?.trim() || "Participant";
}
