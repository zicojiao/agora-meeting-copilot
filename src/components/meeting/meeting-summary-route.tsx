"use client";

import { useRouter } from "next/navigation";
import { MeetingEndedScreen } from "@/components/meeting/meeting-ended-screen";

export function MeetingSummaryRoute({ roomId }: { roomId: string }) {
  const router = useRouter();
  return <MeetingEndedScreen onHome={() => router.push("/")} roomId={roomId} />;
}
