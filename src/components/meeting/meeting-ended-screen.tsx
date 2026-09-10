"use client";

import { ArrowLeft, Download, FileText, NotebookTabs, Package, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getEndedMeetingArtifacts, meetingArtifactUrl, type EndedMeetingArtifacts, type MeetingNotesDocument } from "@/lib/meeting-api";
import { buildUnifiedTranscriptEntries } from "@/lib/unified-transcript";
import { Brand } from "./brand";

export function MeetingEndedScreen({ initialArtifacts, roomId, onHome }: { initialArtifacts?: EndedMeetingArtifacts | null; roomId: string; onHome: () => void }) {
  const [artifacts, setArtifacts] = useState<EndedMeetingArtifacts | null>(initialArtifacts ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialArtifacts);
  const transcriptEntries = useMemo(() => artifacts ? buildUnifiedTranscriptEntries(
    artifacts.transcriptSegments,
    artifacts.copilotTurns ?? [],
    artifacts.room.createdAt
  ) : [], [artifacts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setArtifacts(await getEndedMeetingArtifacts(roomId)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Meeting artifacts are not available."); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { if (!initialArtifacts) void load(); }, [initialArtifacts, load]);

  return (
    <div className="min-h-dvh bg-room text-meeting">
      <header className="sticky top-0 z-20 grid h-16 grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-room/95 px-5 backdrop-blur-md max-sm:h-14 max-sm:px-3">
        <Button aria-label="Back to home" className="justify-self-start px-2 max-sm:size-9 max-sm:p-0" onClick={onHome} size="sm" variant="ghost">
          <ArrowLeft size={18} aria-hidden="true" />
          <span className="max-sm:hidden">Back to home</span>
        </Button>
        <Brand className="justify-self-center" compact hideCopyOnMobile />
        <span aria-hidden="true" />
      </header>
      <main className="mx-auto w-full max-w-[1280px] px-6 py-10 max-sm:px-4 max-sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-7">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase text-agora">Meeting complete</span>
            <h1 className="mt-2 text-3xl font-semibold max-sm:text-2xl">Transcript and notes</h1>
            <p className="mt-2 font-mono text-xs text-meeting-muted">{roomId}</p>
          </div>
          {artifacts ? (
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-10 items-center justify-center gap-2 rounded-[3px] border border-line-strong bg-panel-raised px-3 text-xs font-semibold hover:bg-panel-hover" download="meeting-transcript.md" href={meetingArtifactUrl(roomId, "transcript.md")}><FileText size={15} />Download Transcript</a>
              <a className="inline-flex h-10 items-center justify-center gap-2 rounded-[3px] border border-line-strong bg-panel-raised px-3 text-xs font-semibold hover:bg-panel-hover" download="meeting-notes.md" href={meetingArtifactUrl(roomId, "notes.md")}><NotebookTabs size={15} />Download Notes</a>
              <a className="inline-flex h-10 items-center justify-center gap-2 rounded-[3px] border border-agora bg-agora px-3 text-xs font-semibold text-[#04151b] hover:bg-[#36cff7]" download="meeting-artifacts.zip" href={meetingArtifactUrl(roomId, "all.zip")}><Package size={15} />Download All</a>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center text-center text-meeting-muted">
            <RefreshCw className="mb-3 animate-spin text-agora" size={24} />
            <strong className="text-sm text-meeting-soft">Preparing the meeting record</strong>
            <p className="mt-1.5 text-xs">Finishing the last transcript turns and final notes.</p>
          </div>
        ) : error ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
            <strong className="text-sm">{error}</strong>
            <Button className="mt-4" onClick={() => void load()} size="sm" variant="secondary"><RefreshCw size={14} />Try again</Button>
          </div>
        ) : artifacts ? (
          <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)] gap-10 py-8 max-[900px]:grid-cols-1 max-[900px]:gap-8">
            <MeetingNotes document={artifacts.finalNotes?.document} status={artifacts.finalNotes?.status} />
            <aside className="min-w-0 border-l border-line pl-8 max-[900px]:border-l-0 max-[900px]:border-t max-[900px]:pl-0 max-[900px]:pt-7">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Transcript</h2><span className="font-mono text-[10px] text-meeting-faint">{transcriptEntries.length} turns</span></div>
              <div className="mt-4 grid max-h-[65vh] gap-0 overflow-y-auto border-y border-line">
                {transcriptEntries.length ? transcriptEntries.map((entry) => (
                  <div className="border-b border-line py-3 last:border-b-0" key={`${entry.source}-${entry.id}`}>
                    <div className="flex items-center justify-between gap-3"><strong className={entry.source === "copilot" ? "truncate text-xs text-agora" : "truncate text-xs"}>{entry.speakerName}</strong><time className="font-mono text-[9px] text-meeting-faint">{formatTime(entry.startMs)}</time></div>
                    <p className="mt-1.5 text-xs leading-relaxed text-meeting-soft">{entry.text}</p>
                  </div>
                )) : <p className="py-8 text-center text-xs text-meeting-muted">No speech was transcribed.</p>}
              </div>
              <p className="mt-4 text-[10px] leading-relaxed text-meeting-faint">Available until {new Date(artifacts.room.expiresAt).toLocaleString()}.</p>
            </aside>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function MeetingNotes({ document, status }: { document?: MeetingNotesDocument; status?: string }) {
  if (!document) return (
    <section>
      <h2 className="text-xl font-semibold">Meeting summary unavailable</h2>
      <p className="mt-2 text-sm leading-relaxed text-meeting-muted">The transcript is ready and can still be downloaded. Notes status: {status || "Unavailable"}.</p>
    </section>
  );
  return (
    <section className="min-w-0">
      <span className="font-mono text-[10px] font-bold uppercase text-presence">Meeting summary</span>
      <h2 className="mt-2 text-2xl font-semibold leading-tight">{document.title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-meeting-soft">{document.overview}</p>
      <StringList title="Topics" items={document.topics} />
      <NoteList title="Decisions" items={document.decisions.map((item) => item.text)} />
      <NoteList title="Action items" items={document.actionItems.map((item) => `${item.text}${item.owner ? ` · ${item.owner}` : ""}${item.due ? ` · ${item.due}` : ""}`)} />
      <NoteList title="Open questions" items={document.openQuestions.map((item) => item.text)} />
      <NoteList title="Key points" items={document.keyPoints.map((item) => item.text)} />
    </section>
  );
}

function StringList({ title, items }: { title: string; items: string[] }) {
  return <NoteList items={items} title={title} />;
}

function NoteList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="mt-7 border-t border-line pt-5"><h3 className="text-xs font-semibold uppercase text-meeting-muted">{title}</h3><ul className="mt-3 grid gap-2.5">{items.map((item) => <li className="flex gap-2.5 text-sm leading-relaxed text-meeting-soft" key={item}><Download className="mt-1 size-3.5 shrink-0 rotate-[-90deg] text-agora" />{item}</li>)}</ul></section>;
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
