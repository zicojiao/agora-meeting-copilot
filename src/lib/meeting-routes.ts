import { normalizeRoomCode } from "@/lib/room-code";

export function meetingPath(roomId: string) {
  return routeWithRoom("/", roomId);
}

export function meetingSummaryPath(roomId: string) {
  return routeWithRoom("/summary", roomId);
}

export function meetingBoardPath(roomId: string) {
  return routeWithRoom("/board", roomId);
}

function routeWithRoom(pathname: string, roomId: string) {
  const search = new URLSearchParams({ room: normalizeRoomCode(roomId) });
  return `${pathname}?${search.toString()}`;
}
