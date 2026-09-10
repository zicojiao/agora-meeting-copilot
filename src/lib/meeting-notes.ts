import type { MeetingNoteVersion } from "./meeting-api";

export function mergeVisibleMeetingNotes(
  current: MeetingNoteVersion | null | undefined,
  incoming: MeetingNoteVersion
) {
  if (incoming.document || incoming.status === "completed" || !current?.document) return incoming;
  return {
    ...incoming,
    document: current.document,
    updatedAt: current.updatedAt
  };
}
