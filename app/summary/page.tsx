import { redirect } from "next/navigation";
import { MeetingSummaryRoute } from "@/components/meeting/meeting-summary-route";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ room?: string | string[] }> }) {
  const params = await searchParams;
  const roomId = normalizeRoomCode(Array.isArray(params.room) ? params.room[0] || "" : params.room || "");
  if (!isValidRoomCode(roomId)) redirect("/");
  return <MeetingSummaryRoute roomId={roomId} />;
}
