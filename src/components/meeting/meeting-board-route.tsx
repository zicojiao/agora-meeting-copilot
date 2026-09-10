"use client";

import { ArrowLeft, Columns3, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinMeeting, type RoomSession } from "@/lib/meeting-api";
import { meetingPath } from "@/lib/meeting-routes";
import { loadMeetingSession, saveMeetingSession } from "@/lib/meeting-session";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { BoardWorkspace } from "./board-workspace";
import { Brand } from "./brand";

export function MeetingBoardRoute() {
  const searchParams = useSearchParams();
  const roomId = normalizeRoomCode(searchParams.get("room") || "");
  const [stored, setStored] = useState<{ displayName: string; session: RoomSession } | null>(null);
  const [ready, setReady] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (roomId) setStored(loadMeetingSession(roomId));
    setReady(true);
  }, [roomId]);

  const joinBoard = async (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || !roomId) return;
    setJoining(true);
    setError(null);
    try {
      const hostSecret = window.sessionStorage.getItem(`meeting-host:${roomId}`) || undefined;
      const session = await joinMeeting(roomId, name, hostSecret);
      saveMeetingSession(roomId, name, session);
      setStored({ displayName: name, session });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join this board");
    } finally {
      setJoining(false);
    }
  };

  if (!ready) return <div className="flex min-h-dvh items-center justify-center bg-room text-agora"><LoaderCircle className="animate-spin" /></div>;
  if (!isValidRoomCode(roomId)) return <BoardAccessMessage roomId="" title="Invalid board link" body="Open the board from an active meeting or use a valid room link." />;
  if (stored) return <BoardWorkspace displayName={stored.displayName} roomId={roomId} session={stored.session} />;

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-room px-5 py-10 text-meeting">
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(0,194,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(0,194,255,.035)_1px,transparent_1px)] [background-size:32px_32px]" />
      <section className="relative w-full max-w-[440px] border border-line-strong bg-panel shadow-2xl">
        <div className="border-b border-line px-6 py-5"><Brand /></div>
        <form className="p-6" onSubmit={joinBoard}>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-agora">Shared meeting board</span>
          <h1 className="mt-2 text-2xl font-semibold">Join the board</h1>
          <p className="mt-2 text-sm leading-relaxed text-meeting-muted">Manage tasks without joining audio or video. Your changes sync with everyone in the meeting and with Copilot.</p>
          <div className="mt-5 border border-line bg-room-deep px-3 py-2 font-mono text-[11px] text-meeting-soft">{roomId}</div>
          <label className="mt-5 block text-xs font-semibold text-meeting-soft" htmlFor="board-display-name">Your name</label>
          <Input autoFocus className="mt-2" id="board-display-name" maxLength={60} onChange={(event) => setDisplayName(event.target.value)} placeholder="Enter your name" value={displayName} />
          {error ? <p className="mt-3 text-xs text-danger" role="alert">{error}</p> : null}
          <Button className="mt-5" disabled={joining || !displayName.trim()} fullWidth type="submit" variant="primary">
            {joining ? <LoaderCircle className="animate-spin" size={16} /> : <Columns3 size={16} />}{joining ? "Joining…" : "Open board"}
          </Button>
          <Link className="mt-3 flex items-center justify-center gap-2 py-2 text-xs text-meeting-muted hover:text-meeting" href={meetingPath(roomId)}><ArrowLeft size={14} />Join the meeting instead</Link>
        </form>
      </section>
    </main>
  );
}

function BoardAccessMessage({ body, roomId, title }: { body: string; roomId: string; title: string }) {
  return <main className="flex min-h-dvh items-center justify-center bg-room p-6 text-meeting"><section className="max-w-md border border-line bg-panel p-6 text-center"><Columns3 className="mx-auto text-agora" /><h1 className="mt-3 text-xl font-semibold">{title}</h1><p className="mt-2 text-sm text-meeting-muted">{body}</p><Link className="mt-5 inline-flex items-center gap-2 text-sm text-agora" href={roomId ? meetingPath(roomId) : "/"}><ArrowLeft size={14} />Back to meeting</Link></section></main>;
}
