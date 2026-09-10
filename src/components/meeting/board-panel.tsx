"use client";

import { CalendarDays, CircleCheck, CircleDashed, CircleDot, ExternalLink, ListTodo, Radio, UserRound } from "lucide-react";
import Link from "next/link";
import type { KanbanCard, KanbanStatus } from "@/lib/meeting-api";
import { meetingBoardPath } from "@/lib/meeting-routes";
import { cn } from "@/lib/utils";

const lanes: Array<{ status: KanbanStatus; label: string; icon: React.ReactNode; tone: string }> = [
  { status: "backlog", label: "Backlog", icon: <CircleDashed size={13} />, tone: "text-meeting-muted" },
  { status: "in_progress", label: "In progress", icon: <Radio size={13} />, tone: "text-agora" },
  { status: "blocked", label: "Blocked", icon: <CircleDot size={13} />, tone: "text-warning" },
  { status: "done", label: "Done", icon: <CircleCheck size={13} />, tone: "text-presence" }
];

export function BoardPanel({ cards, roomId }: { cards: KanbanCard[]; roomId: string }) {
  return (
    <div className="flex size-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-agora">
          <Radio className="animate-pulse" size={12} />Voice-synced board
        </span>
        <div className="flex items-center gap-3"><span className="font-mono text-[9px] uppercase text-meeting-faint">{cards.length} {cards.length === 1 ? "card" : "cards"}</span><Link className="inline-flex items-center gap-1.5 border-l border-line pl-3 text-[10px] font-semibold text-agora hover:text-meeting" href={meetingBoardPath(roomId)} rel="noopener noreferrer" target="_blank">Open full board<ExternalLink size={11} /></Link></div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
        <div className="grid min-w-[610px] grid-cols-4 items-start gap-2.5" aria-label="Meeting Kanban board">
          {lanes.map((lane) => {
            const laneCards = cards.filter((card) => card.status === lane.status);
            return (
              <section aria-labelledby={`kanban-${lane.status}`} className="min-w-0 border-t border-line-strong bg-room-deep/35" key={lane.status}>
                <header className="flex h-10 items-center gap-1.5 border-b border-line px-2.5">
                  <span className={cn("flex shrink-0", lane.tone)}>{lane.icon}</span>
                  <h3 className="min-w-0 flex-1 truncate font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-meeting-soft" id={`kanban-${lane.status}`}>{lane.label}</h3>
                  <span className="font-mono text-[9px] text-meeting-faint">{laneCards.length}</span>
                </header>
                <div className="grid min-h-24 gap-2 p-2">
                  {laneCards.length ? laneCards.map((card) => <BoardCard card={card} key={card.id} />) : (
                    <div className="flex min-h-20 items-center justify-center border border-dashed border-line px-2 text-center font-mono text-[9px] uppercase leading-relaxed text-meeting-faint">No cards</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {!cards.length ? (
          <div className="mx-auto mt-6 max-w-md border border-agora/20 bg-agora/[0.04] px-5 py-4 text-center">
            <ListTodo className="mx-auto text-agora" size={21} />
            <strong className="mt-2 block text-sm text-meeting-soft">Build the board by voice</strong>
            <p className="mt-1 text-xs leading-relaxed text-meeting-muted">Say “Copilot, create a board card for the launch checklist.”</p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-line px-4 py-2.5 text-[10px] leading-relaxed text-meeting-muted">
        Ask Copilot to create, move, assign, tag, or complete a card. Only the host can delete cards.
      </div>
    </div>
  );
}

function BoardCard({ card }: { card: KanbanCard }) {
  return (
    <article className={cn(
      "border border-line bg-panel px-2.5 py-2.5 shadow-[0_6px_18px_rgba(0,0,0,0.12)]",
      card.status === "in_progress" && "border-l-2 border-l-agora",
      card.status === "blocked" && "border-l-2 border-l-warning",
      card.status === "done" && "border-l-2 border-l-presence"
    )}>
      <h4 className="text-[12px] font-semibold leading-snug text-meeting">{card.title}</h4>
      {card.notes ? <p className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-meeting-muted">{card.notes}</p> : null}
      {card.assignee ? <div className="mt-2 flex items-center gap-1.5 text-[9px] text-meeting-soft"><UserRound size={10} /><span className="truncate">{card.assignee}</span></div> : null}
      {card.dueDate ? <div className="mt-1.5 flex items-center gap-1.5 text-[9px] text-meeting-muted"><CalendarDays size={10} />{new Date(`${card.dueDate}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</div> : null}
      {card.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.map((tag) => <span className="border border-line-strong bg-room-deep px-1.5 py-0.5 font-mono text-[8px] uppercase text-meeting-muted" key={tag}>{tag}</span>)}
        </div>
      ) : null}
    </article>
  );
}
