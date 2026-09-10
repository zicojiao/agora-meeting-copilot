import { Suspense } from "react";
import { MeetingBoardRoute } from "@/components/meeting/meeting-board-route";

export default function BoardPage() {
  return <Suspense fallback={<div className="min-h-dvh bg-room" />}><MeetingBoardRoute /></Suspense>;
}
