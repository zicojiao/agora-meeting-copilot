import type { RoomSession } from "./meeting-api";

type StoredMeetingSession = { displayName: string; session: RoomSession };

export function saveMeetingSession(roomId: string, displayName: string, session: RoomSession) {
  window.sessionStorage.setItem(sessionKey(roomId), JSON.stringify({ displayName, session } satisfies StoredMeetingSession));
}

export function loadMeetingSession(roomId: string): StoredMeetingSession | null {
  try {
    const value = window.sessionStorage.getItem(sessionKey(roomId));
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredMeetingSession;
    if (!parsed.displayName || !parsed.session?.capability || parsed.session.expiresAt * 1_000 <= Date.now()) {
      window.sessionStorage.removeItem(sessionKey(roomId));
      return null;
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(sessionKey(roomId));
    return null;
  }
}

export function clearMeetingSession(roomId: string) {
  window.sessionStorage.removeItem(sessionKey(roomId));
}

function sessionKey(roomId: string) { return `meeting-session:${roomId}`; }
