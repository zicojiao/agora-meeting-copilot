"use client";

import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Columns3,
  GripVertical,
  ListFilter,
  LoaderCircle,
  Mic2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogBackdrop, DialogSurface } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRoomBoard } from "@/hooks/use-room-board";
import type { KanbanActivity, KanbanCard, KanbanPriority, KanbanStatus, RoomParticipant, RoomSession } from "@/lib/meeting-api";
import { meetingPath } from "@/lib/meeting-routes";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";

const lanes: Array<{ status: KanbanStatus; label: string; accent: string }> = [
  { status: "backlog", label: "Backlog", accent: "bg-meeting-faint" },
  { status: "in_progress", label: "In progress", accent: "bg-agora" },
  { status: "blocked", label: "Blocked", accent: "bg-warning" },
  { status: "done", label: "Done", accent: "bg-presence" }
];

const priorities: KanbanPriority[] = ["low", "medium", "high", "urgent"];
const emptyCards: KanbanCard[] = [];

export function BoardWorkspace({ displayName, roomId, session }: { displayName: string; roomId: string; session: RoomSession }) {
  const board = useRoomBoard(roomId, session);
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [editor, setEditor] = useState<KanbanCard | { kind: "new"; status: KanbanStatus } | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const state = board.state;
  const cards = state?.kanbanCards ?? emptyCards;
  const participants = (state?.participants ?? []).filter((participant) => participant.role !== "ai");

  const filteredCards = useMemo(() => cards.filter((card) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query || [card.title, card.notes, card.assignee ?? "", ...card.tags].some((value) => value.toLocaleLowerCase().includes(query));
    const matchesAssignee = assigneeFilter === "all" ? true : assigneeFilter === "unassigned" ? !card.assigneeUid : card.assigneeUid === assigneeFilter;
    return matchesSearch && matchesAssignee;
  }), [assigneeFilter, cards, search]);

  const moveCard = async (card: KanbanCard, status: KanbanStatus) => {
    if (card.status === status) return;
    try {
      await board.updateCard(card.id, { expectedVersion: card.version, status });
      toast.success(`Moved to ${laneLabel(status)}`);
    } catch (caught) { toast.error(errorMessage(caught)); }
  };

  return (
    <main className="grid h-dvh grid-rows-[58px_minmax(0,1fr)] overflow-hidden bg-room text-meeting">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-room-deep px-4 max-[760px]:grid-cols-[auto_1fr_auto] max-sm:px-2.5">
        <Brand compact hideCopyOnMobile />
        <div className="flex min-w-0 items-center justify-center gap-2">
          <Columns3 className="text-agora" size={15} />
          <div className="min-w-0"><h1 className="text-xs font-semibold leading-tight">Meeting board</h1><span className="block truncate font-mono text-[8px] text-meeting-faint">{roomId}</span></div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="mr-1 hidden items-center gap-1.5 text-[10px] text-meeting-muted sm:flex"><UsersRound size={13} />{participants.length}<span className="max-w-28 truncate">· {displayName}</span></span>
          <Link aria-label="Back to meeting" className="inline-flex h-9 items-center gap-1.5 rounded-[3px] border border-line px-3 text-xs text-meeting-soft hover:bg-panel-raised" href={meetingPath(roomId)}><ArrowLeft size={14} /><span className="max-sm:hidden">Meeting</span></Link>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] max-[1180px]:grid-cols-1">
        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden" aria-label="Board workspace">
          <div className="border-b border-line bg-panel/45 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[220px] flex-1 max-w-lg">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-meeting-faint" size={14} />
                <Input aria-label="Search board" className="h-9 pl-9 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search title, notes, people, or tags" value={search} />
              </div>
              <label className="relative">
                <span className="sr-only">Filter by assignee</span>
                <ListFilter className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-meeting-faint" size={13} />
                <select aria-label="Filter by assignee" className="h-9 rounded-[3px] border border-line bg-room-deep pl-9 pr-8 text-xs text-meeting-soft outline-none focus:border-agora" onChange={(event) => setAssigneeFilter(event.target.value)} value={assigneeFilter}>
                  <option value="all">Everyone</option><option value="unassigned">Unassigned</option>
                  {participants.map((participant) => <option key={participant.rtcUid} value={participant.rtcUid}>{participant.displayName}</option>)}
                </select>
              </label>
              <Button onClick={() => setEditor({ kind: "new", status: "backlog" })} size="sm" variant="primary"><Plus size={15} />New card</Button>
              <Button className="hidden max-[1180px]:inline-flex" onClick={() => setActivityOpen(true)} size="sm"><Activity size={14} />Activity</Button>
            </div>
            <div className="mt-3 flex items-center gap-3 overflow-hidden">
              <span className="shrink-0 font-mono text-[9px] uppercase text-meeting-faint">{cards.length} cards</span>
              <div className="h-1 flex-1 overflow-hidden bg-line"><div className="h-full bg-presence transition-[width]" style={{ width: `${cards.length ? Math.round(cards.filter((card) => card.status === "done").length / cards.length * 100) : 0}%` }} /></div>
              <span className="shrink-0 font-mono text-[9px] text-meeting-faint">{cards.filter((card) => card.status === "done").length}/{cards.length} done</span>
              <span className="hidden shrink-0 items-center gap-1.5 border-l border-line pl-3 text-[10px] text-meeting-muted md:flex"><Mic2 className="text-agora" size={12} />Say “Copilot, create a board card…”</span>
            </div>
          </div>

          <div className="min-h-0 overflow-auto p-3.5">
            {board.loading && !state ? <div className="flex h-full items-center justify-center text-agora"><LoaderCircle className="animate-spin" /></div> : null}
            {board.error ? <div className="mb-3 flex items-center gap-2 border border-danger/30 bg-danger/8 px-3 py-2 text-xs text-danger"><CircleAlert size={14} />{board.error}</div> : null}
            <div className="grid min-w-[920px] grid-cols-4 items-start gap-3" aria-label="Kanban columns">
              {lanes.map((lane) => {
                const laneCards = filteredCards.filter((card) => card.status === lane.status).sort((a, b) => a.position - b.position);
                return (
                  <section
                    aria-labelledby={`workspace-${lane.status}`}
                    className="min-h-[calc(100dvh-170px)] border border-line bg-room-deep/55"
                    key={lane.status}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => { const card = cards.find((item) => item.id === draggedId); setDraggedId(null); if (card) void moveCard(card, lane.status); }}
                  >
                    <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-line bg-panel/95 px-3 backdrop-blur">
                      <i className={cn("h-4 w-0.5", lane.accent)} />
                      <h2 className="flex-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-meeting-soft" id={`workspace-${lane.status}`}>{lane.label}</h2>
                      <span className="font-mono text-[9px] text-meeting-faint">{laneCards.length}</span>
                      <button aria-label={`Add card to ${lane.label}`} className="text-meeting-faint hover:text-agora" onClick={() => setEditor({ kind: "new", status: lane.status })} type="button"><Plus size={15} /></button>
                    </header>
                    <div className="grid gap-2.5 p-2.5">
                      {laneCards.map((card) => <WorkspaceCard card={card} key={card.id} onDragStart={() => setDraggedId(card.id)} onEdit={() => setEditor(card)} />)}
                      {!laneCards.length ? <button className="flex min-h-24 items-center justify-center border border-dashed border-line text-[10px] text-meeting-faint hover:border-agora/40 hover:text-agora" onClick={() => setEditor({ kind: "new", status: lane.status })} type="button">Drop here or add a card</button> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </section>

        <ActivityRail activities={state?.kanbanActivities ?? []} className="border-l border-line max-[1180px]:hidden" />
      </div>

      {activityOpen ? <div className="fixed inset-0 z-70 bg-black/65" onClick={() => setActivityOpen(false)}><div className="absolute inset-y-0 right-0 w-[min(340px,92vw)]" onClick={(event) => event.stopPropagation()}><ActivityRail activities={state?.kanbanActivities ?? []} className="h-full border-l border-line shadow-2xl" onClose={() => setActivityOpen(false)} /></div></div> : null}
      {editor ? <CardEditor card={"kind" in editor ? undefined : editor} canDelete={!("kind" in editor) && (session.role === "host" || editor.createdByUid === String(session.rtcUid))} initialStatus={"kind" in editor ? editor.status : undefined} onClose={() => setEditor(null)} onCreate={board.createCard} onDelete={board.deleteCard} onUpdate={board.updateCard} participants={participants} /> : null}
    </main>
  );
}

function WorkspaceCard({ card, onDragStart, onEdit }: { card: KanbanCard; onDragStart: () => void; onEdit: () => void }) {
  const overdue = card.dueDate && card.status !== "done" && card.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <article className="group border border-line bg-panel shadow-[0_8px_20px_rgba(0,0,0,.16)] transition hover:-translate-y-0.5 hover:border-line-strong" draggable onDragEnd={() => undefined} onDragStart={onDragStart}>
      <button className="w-full p-3 text-left" onClick={onEdit} type="button">
        <div className="flex items-start gap-2">
          <GripVertical className="mt-0.5 shrink-0 text-meeting-faint opacity-50 group-hover:opacity-100" size={14} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5"><PriorityMark priority={card.priority} />{card.sourceTurnKey.startsWith("manual:") ? null : <span className="inline-flex items-center gap-1 font-mono text-[8px] uppercase text-agora"><Mic2 size={9} />AI</span>}</div>
            <h3 className="mt-1.5 text-[13px] font-semibold leading-snug text-meeting">{card.title}</h3>
            {card.notes ? <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-meeting-muted">{card.notes}</p> : null}
          </div>
        </div>
        {card.tags.length ? <div className="mt-2.5 flex flex-wrap gap-1 pl-[22px]">{card.tags.map((tag) => <span className="border border-line bg-room-deep px-1.5 py-0.5 font-mono text-[8px] uppercase text-meeting-muted" key={tag}>{tag}</span>)}</div> : null}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5 pl-[22px] text-[9px] text-meeting-muted">
          <span className="min-w-0 truncate">{card.assignee ? <span className="inline-flex items-center gap-1"><UserRound size={10} />{card.assignee}</span> : "Unassigned"}</span>
          {card.dueDate ? <span className={cn("inline-flex shrink-0 items-center gap-1", overdue && "text-danger")}><CalendarDays size={10} />{shortDate(card.dueDate)}</span> : null}
        </div>
      </button>
    </article>
  );
}

function CardEditor({ card, canDelete, initialStatus, onClose, onCreate, onDelete, onUpdate, participants }: {
  card?: KanbanCard;
  canDelete: boolean;
  initialStatus?: KanbanStatus;
  onClose: () => void;
  onCreate: ReturnType<typeof useRoomBoard>["createCard"];
  onDelete: ReturnType<typeof useRoomBoard>["deleteCard"];
  onUpdate: ReturnType<typeof useRoomBoard>["updateCard"];
  participants: RoomParticipant[];
}) {
  const [title, setTitle] = useState(card?.title ?? "");
  const [notes, setNotes] = useState(card?.notes ?? "");
  const [status, setStatus] = useState<KanbanStatus>(card?.status ?? initialStatus ?? "backlog");
  const [priority, setPriority] = useState<KanbanPriority>(card?.priority ?? "medium");
  const [assigneeUid, setAssigneeUid] = useState(card?.assigneeUid ?? "");
  const [dueDate, setDueDate] = useState(card?.dueDate ?? "");
  const [tags, setTags] = useState(card?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const input = { title: title.trim(), notes, status, priority, assigneeUid: assigneeUid || undefined, dueDate: dueDate || undefined, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
    try {
      if (card) await onUpdate(card.id, { ...input, assigneeUid: assigneeUid || null, dueDate: dueDate || null, expectedVersion: card.version });
      else await onCreate(input);
      toast.success(card ? "Card updated" : "Card created");
      onClose();
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!card || !canDelete) return;
    setSaving(true);
    try { await onDelete(card.id); toast.success("Card deleted"); onClose(); }
    catch (caught) { toast.error(errorMessage(caught)); setSaving(false); }
  };

  return (
    <DialogBackdrop onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <DialogSurface aria-labelledby="board-card-editor-title" aria-modal="true" className="max-h-[92dvh] max-w-[620px] overflow-y-auto p-0" role="dialog">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4"><span className="flex size-9 items-center justify-center border border-agora/25 bg-agora/8 text-agora">{card ? <Pencil size={16} /> : <Plus size={17} />}</span><div className="min-w-0 flex-1"><span className="font-mono text-[9px] uppercase text-agora">Board card</span><h2 className="text-lg font-semibold" id="board-card-editor-title">{card ? "Edit card" : "Create card"}</h2></div><Button aria-label="Close card editor" disabled={saving} onClick={onClose} size="icon-sm" variant="ghost"><X size={17} /></Button></header>
        <form className="grid gap-4 p-5" onSubmit={save}>
          <Field label="Title"><Input autoFocus maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to happen?" required value={title} /></Field>
          <Field label="Description"><textarea className="min-h-24 w-full resize-y rounded-[3px] border border-line bg-room-deep px-3 py-2.5 text-sm text-meeting outline-none placeholder:text-meeting-faint focus:border-agora" maxLength={1_000} onChange={(event) => setNotes(event.target.value)} placeholder="Context, acceptance criteria, or next step" value={notes} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="Status"><Select onChange={(value) => setStatus(value as KanbanStatus)} value={status}>{lanes.map((lane) => <option key={lane.status} value={lane.status}>{lane.label}</option>)}</Select></Field>
            <Field label="Priority"><Select onChange={(value) => setPriority(value as KanbanPriority)} value={priority}>{priorities.map((value) => <option key={value} value={value}>{capitalize(value)}</option>)}</Select></Field>
            <Field label="Assignee"><Select onChange={setAssigneeUid} value={assigneeUid}><option value="">Unassigned</option>{participants.map((participant) => <option key={participant.rtcUid} value={participant.rtcUid}>{participant.displayName}</option>)}</Select></Field>
            <Field label="Due date"><Input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></Field>
          </div>
          <Field hint="Comma-separated, up to 6" label="Tags"><Input maxLength={160} onChange={(event) => setTags(event.target.value)} placeholder="launch, customer, backend" value={tags} /></Field>
          {card ? <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 font-mono text-[9px] text-meeting-faint"><span>Created by {card.createdByName}</span><span>Version {card.version}</span><span>{card.sourceTurnKey.startsWith("manual:") ? "Manual" : "Via Copilot"}</span></div> : null}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            {card && canDelete ? <Button disabled={saving} onClick={() => void remove()} size="sm" variant="ghost"><Trash2 className="text-danger" size={14} /><span className="text-danger">Delete</span></Button> : <span />}
            <div className="flex gap-2"><Button disabled={saving} onClick={onClose} size="sm">Cancel</Button><Button disabled={saving || !title.trim()} size="sm" type="submit" variant="primary">{saving ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} />}{card ? "Save changes" : "Create card"}</Button></div>
          </div>
        </form>
      </DialogSurface>
    </DialogBackdrop>
  );
}

function ActivityRail({ activities, className, onClose }: { activities: KanbanActivity[]; className?: string; onClose?: () => void }) {
  return (
    <aside className={cn("flex min-h-0 flex-col bg-panel", className)} aria-label="Board activity">
      <header className="flex h-12 items-center gap-2 border-b border-line px-4"><Activity className="text-agora" size={15} /><h2 className="flex-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em]">Activity</h2>{onClose ? <Button aria-label="Close activity" onClick={onClose} size="icon-sm" variant="ghost"><X size={16} /></Button> : null}</header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activities.length ? <ol className="divide-y divide-line">{activities.map((activity) => <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 px-4 py-3" key={activity.id}><span className={cn("mt-0.5 flex size-7 items-center justify-center border", activity.source === "voice" ? "border-agora/25 bg-agora/8 text-agora" : "border-line bg-room-deep text-meeting-muted")}>{activity.source === "voice" ? <Mic2 size={12} /> : <Pencil size={11} />}</span><div className="min-w-0"><p className="text-[11px] leading-relaxed text-meeting-soft"><strong className="text-meeting">{activity.actorName}</strong> {activity.source === "voice" ? "via Copilot" : "manually"}</p><p className="mt-0.5 text-[10px] leading-relaxed text-meeting-muted">{activity.detail}</p><div className="mt-1.5 flex items-center gap-1 text-[9px] text-meeting-faint"><span className="truncate">{activity.cardTitle}</span><ChevronRight size={9} /><time className="shrink-0">{relativeTime(activity.createdAt)}</time></div></div></li>)}</ol> : <div className="flex min-h-48 flex-col items-center justify-center px-8 text-center text-meeting-muted"><Activity className="mb-2 text-agora" size={20} /><strong className="text-xs text-meeting-soft">No board activity yet</strong><p className="mt-1 text-[10px] leading-relaxed">Manual changes and Copilot commands will appear here.</p></div>}
      </div>
    </aside>
  );
}

function Field({ children, hint, label }: { children: React.ReactNode; hint?: string; label: string }) { return <label className="grid gap-1.5 text-xs font-semibold text-meeting-soft"><span className="flex justify-between">{label}{hint ? <small className="font-normal text-meeting-faint">{hint}</small> : null}</span>{children}</label>; }

function Select({ children, onChange, value }: { children: React.ReactNode; onChange: (value: KanbanStatus | string) => void; value: string }) { return <select className="h-10 w-full rounded-[3px] border border-line bg-room-deep px-3 text-sm text-meeting outline-none focus:border-agora" onChange={(event) => onChange(event.target.value)} value={value}>{children}</select>; }

function PriorityMark({ priority }: { priority: KanbanPriority }) { return <span className={cn("inline-flex items-center gap-1 font-mono text-[8px] font-bold uppercase", priority === "urgent" ? "text-danger" : priority === "high" ? "text-warning" : priority === "medium" ? "text-agora" : "text-meeting-faint")}><i className="h-1.5 w-1.5 rounded-full bg-current" />{priority}</span>; }

function laneLabel(status: KanbanStatus) { return lanes.find((lane) => lane.status === status)?.label ?? status; }
function shortDate(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }); }
function capitalize(value: string) { return value[0].toUpperCase() + value.slice(1); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Board request failed"; }
function relativeTime(value: string) { const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000)); if (seconds < 60) return "now"; if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`; return `${Math.floor(seconds / 86_400)}d`; }
