"use client";

import { ArrowUpRight, CircleDot, LoaderCircle, NotebookTabs } from "lucide-react";
import type { MeetingNoteEvidence, MeetingNoteVersion } from "@/lib/meeting-api";

export function NotesPanel({ notes, onEvidence }: { notes: MeetingNoteVersion | null | undefined; onEvidence: (evidence: MeetingNoteEvidence) => void }) {
  const document = notes?.document;
  return (
    <div className="size-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase text-meeting-soft">
          {notes?.status === "pending" ? <LoaderCircle className="animate-spin text-warning" size={13} /> : <CircleDot className={notes?.status === "failed" ? "text-danger" : "text-presence"} size={13} />}
          {notesStatus(notes)}
        </span>
        {notes?.updatedAt ? <time className="text-[10px] text-meeting-faint">{new Date(notes.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}
      </div>
      {!document ? (
        <div className="flex min-h-[70%] flex-col items-center justify-center px-8 text-center text-meeting-muted">
          <NotebookTabs className="mb-3 text-agora" size={22} />
          <strong className="text-sm text-meeting-soft">Notes are warming up</strong>
          <p className="mt-1.5 text-xs leading-relaxed">Decisions, actions, and open questions appear as the meeting develops.</p>
        </div>
      ) : (
        <div className="px-4 pb-8 pt-4">
          <h3 className="text-lg font-semibold leading-tight">{document.title}</h3>
          {document.overview ? <p className="mt-2 text-[13px] leading-relaxed text-meeting-soft">{document.overview}</p> : null}
          <StringSection title="Topics" items={document.topics} />
          <EvidenceSection title="Decisions" items={document.decisions} onEvidence={onEvidence} />
          <EvidenceSection title="Action items" items={document.actionItems.map((item) => ({ ...item, text: `${item.text}${item.owner ? ` · ${item.owner}` : ""}${item.due ? ` · ${item.due}` : ""}` }))} onEvidence={onEvidence} />
          <EvidenceSection title="Open questions" items={document.openQuestions} onEvidence={onEvidence} />
          <EvidenceSection title="Key points" items={document.keyPoints} onEvidence={onEvidence} />
        </div>
      )}
    </div>
  );
}

function StringSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="mt-5 border-t border-line pt-4"><h4 className="mb-2 text-[10px] font-bold uppercase text-meeting-muted">{title}</h4><ul className="grid gap-1.5">{items.map((item) => <li className="text-[13px] leading-relaxed text-meeting-soft" key={item}>• {item}</li>)}</ul></section>;
}

function EvidenceSection({ title, items, onEvidence }: { title: string; items: Array<{ text: string; evidence: MeetingNoteEvidence[] }>; onEvidence: (evidence: MeetingNoteEvidence) => void }) {
  if (!items.length) return null;
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h4 className="mb-2 text-[10px] font-bold uppercase text-meeting-muted">{title}</h4>
      <div className="grid gap-3">
        {items.map((item) => (
          <div key={`${title}-${item.text}`}>
            <p className="text-[13px] leading-relaxed text-meeting-soft">{item.text}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.evidence.map((evidence) => (
                <button className="inline-flex items-center gap-1 rounded-[2px] border border-line px-1.5 py-1 font-mono text-[9px] text-meeting-muted hover:border-agora/50 hover:text-agora" key={evidence.segmentId} onClick={() => onEvidence(evidence)} type="button">
                  {formatTime(evidence.startMs)} {evidence.speakerName}<ArrowUpRight size={10} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function notesStatus(notes?: MeetingNoteVersion | null) {
  if (!notes) return "Live notes pending";
  if (notes.status === "pending") return "Updating live notes";
  if (notes.status === "failed") return "Notes need retry";
  return notes.kind === "final" ? "Final notes" : "Live notes";
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
