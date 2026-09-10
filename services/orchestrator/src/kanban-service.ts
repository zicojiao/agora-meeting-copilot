import { randomUUID } from "node:crypto";
import type {
  KanbanActivity,
  KanbanCard,
  KanbanCommandRecord,
  KanbanOperation,
  KanbanPriority,
  KanbanStatus,
  ParticipantRecord
} from "./domain.js";
import type { EventBus } from "./events.js";
import type { Store } from "./store/store.js";

export type CreateKanbanCardInput = {
  title: string;
  notes?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  assigneeUid?: string;
  dueDate?: string;
  tags?: string[];
};

export type UpdateKanbanCardInput = {
  expectedVersion: number;
  title?: string;
  notes?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  assigneeUid?: string | null;
  dueDate?: string | null;
  tags?: string[];
  position?: number;
};

export class KanbanService {
  constructor(private store: Store, private events: EventBus) {}

  async executeGptLiveFunction(roomId: string, callId: string, operation: KanbanOperation) {
    const room = await this.store.getRoom(roomId);
    if (!room || room.status !== "open") throw Object.assign(new Error("Meeting room is not open"), { statusCode: 409 });
    const participants = await this.store.listParticipants(roomId);
    const actor = participants.find((participant) => participant.rtcUid === "900001" && participant.role === "ai");
    if (!actor) throw new Error("GPT Live Copilot is not present in the meeting");
    const now = new Date().toISOString();
    const command: KanbanCommandRecord = {
      id: randomUUID(), roomId, sourceTurnKey: `gpt-live:${callId}`, operationIndex: 0,
      speakerUid: actor.rtcUid, operation, status: "pending", createdAt: now, updatedAt: now
    };
    if (!await this.store.createKanbanCommand(command)) return { ok: true, duplicate: true, callId };
    try {
      const { result, activity } = await this.executeVoiceOperation(roomId, actor, command.sourceTurnKey, operation);
      command.status = "completed";
      command.result = result;
      command.updatedAt = new Date().toISOString();
      await this.store.updateKanbanCommand(command);
      await this.publishBoard(roomId, activity);
      return { ok: true, ...result };
    } catch (error) {
      command.status = "failed";
      command.error = safeError(error);
      command.updatedAt = new Date().toISOString();
      await this.store.updateKanbanCommand(command);
      await this.events.publish(roomId, "kanban.command.failed", { sourceTurnKey: command.sourceTurnKey, operationIndex: 0, error: command.error });
      throw error;
    }
  }

  async createManualCard(roomId: string, actorUid: string, input: CreateKanbanCardInput) {
    const actor = await this.requireActor(roomId, actorUid);
    const participants = await this.store.listParticipants(roomId);
    const status = input.status ?? "backlog";
    const assignee = resolveAssigneeByUid(input.assigneeUid, participants);
    const now = new Date().toISOString();
    const cards = await this.store.listKanbanCards(roomId);
    const card: KanbanCard = {
      id: randomUUID(), roomId, title: requiredText(input.title, "Card title", 120), notes: optionalText(input.notes, 1_000),
      status, priority: input.priority ?? "medium", assigneeUid: assignee?.rtcUid, assignee: assignee?.displayName,
      dueDate: normalizeDueDate(input.dueDate), tags: normalizeTags(input.tags), position: nextPosition(cards, status), version: 1,
      createdByUid: actor.rtcUid, createdByName: actor.displayName, sourceTurnKey: `manual:${randomUUID()}`, createdAt: now, updatedAt: now
    };
    await this.store.createKanbanCard(card);
    const activity = await this.recordActivity(card, actor, "manual", "created", `Created in ${statusLabel(card.status)}`);
    await this.publishBoard(roomId, activity);
    return card;
  }

  async updateManualCard(roomId: string, actorUid: string, cardId: string, input: UpdateKanbanCardInput) {
    const actor = await this.requireActor(roomId, actorUid);
    const [cards, participants] = await Promise.all([this.store.listKanbanCards(roomId), this.store.listParticipants(roomId)]);
    const existing = resolveCard(cards, cardId);
    if (existing.version !== input.expectedVersion) throw conflict();
    const card = { ...existing, tags: [...existing.tags] };
    const previousStatus = card.status;
    const assignmentChanged = input.assigneeUid !== undefined;

    if (input.title !== undefined) card.title = requiredText(input.title, "Card title", 120);
    if (input.notes !== undefined) card.notes = optionalText(input.notes, 1_000);
    if (input.priority !== undefined) card.priority = input.priority;
    if (input.tags !== undefined) card.tags = normalizeTags(input.tags);
    if (input.dueDate !== undefined) card.dueDate = input.dueDate === null ? undefined : normalizeDueDate(input.dueDate);
    if (assignmentChanged) {
      const assignee = input.assigneeUid === null ? undefined : resolveAssigneeByUid(input.assigneeUid, participants);
      card.assigneeUid = assignee?.rtcUid;
      card.assignee = assignee?.displayName;
    }
    if (input.status !== undefined) card.status = input.status;
    if (input.position !== undefined) card.position = finitePosition(input.position);
    else if (card.status !== previousStatus) card.position = nextPosition(cards, card.status);
    card.version = existing.version + 1;
    card.updatedAt = new Date().toISOString();

    if (!await this.store.updateKanbanCard(card, existing.version)) throw conflict();
    const action: KanbanActivity["action"] = card.status !== previousStatus ? "moved" : assignmentChanged ? "assigned" : input.tags !== undefined ? "tagged" : "updated";
    const detail = action === "moved" ? `Moved from ${statusLabel(previousStatus)} to ${statusLabel(card.status)}`
      : action === "assigned" ? card.assignee ? `Assigned to ${card.assignee}` : "Cleared assignee"
        : action === "tagged" ? "Updated tags" : "Updated card details";
    const activity = await this.recordActivity(card, actor, "manual", action, detail);
    await this.publishBoard(roomId, activity);
    return card;
  }

  async deleteManualCard(roomId: string, actorUid: string, cardId: string) {
    const actor = await this.requireActor(roomId, actorUid);
    const card = resolveCard(await this.store.listKanbanCards(roomId), cardId);
    if (actor.role !== "host" && card.createdByUid !== actor.rtcUid) {
      throw Object.assign(new Error("Only the host or the card creator can delete this card"), { statusCode: 403 });
    }
    await this.store.deleteKanbanCard(roomId, card.id);
    const activity = await this.recordActivity(card, actor, "manual", "deleted", "Deleted card");
    await this.publishBoard(roomId, activity);
  }

  private async executeVoiceOperation(roomId: string, actor: ParticipantRecord, sourceTurnKey: string, operation: KanbanOperation) {
    const [cards, participants] = await Promise.all([this.store.listKanbanCards(roomId), this.store.listParticipants(roomId)]);
    if (operation.type === "create") {
      const status = operation.status ?? "backlog";
      const assignee = resolveAssigneeByName(operation.assignee, participants);
      const now = new Date().toISOString();
      const card: KanbanCard = {
        id: randomUUID(), roomId, title: requiredText(operation.title, "Card title", 120), notes: optionalText(operation.notes, 1_000),
        status, priority: operation.priority ?? "medium", assigneeUid: assignee?.rtcUid, assignee: assignee?.displayName,
        dueDate: normalizeDueDate(operation.dueDate), tags: normalizeTags(operation.tags), position: nextPosition(cards, status), version: 1,
        createdByUid: actor.rtcUid, createdByName: actor.displayName, sourceTurnKey, createdAt: now, updatedAt: now
      };
      await this.store.createKanbanCard(card);
      const activity = await this.recordActivity(card, actor, "voice", "created", `Created via Copilot in ${statusLabel(card.status)}`);
      return { result: { cardId: card.id, title: card.title, status: card.status }, activity };
    }

    const existing = resolveCard(cards, operation.cardId, operation.cardQuery);
    if (operation.type === "delete") {
      if (actor.role !== "host") throw new Error("Only the host can delete board cards by voice");
      await this.store.deleteKanbanCard(roomId, existing.id);
      const activity = await this.recordActivity(existing, actor, "voice", "deleted", "Deleted via Copilot");
      return { result: { cardId: existing.id, title: existing.title, deleted: true }, activity };
    }

    const card = { ...existing, tags: [...existing.tags] };
    const previousStatus = card.status;
    if (operation.type === "move") {
      if (!operation.status) throw new Error("A destination status is required");
      card.status = operation.status;
      card.position = nextPosition(cards, card.status);
    } else if (operation.type === "add_tags") {
      card.tags = normalizeTags([...card.tags, ...(operation.tags ?? [])]);
    } else {
      if (operation.title) card.title = requiredText(operation.title, "Card title", 120);
      if (operation.notes) card.notes = optionalText(operation.notes, 1_000);
      if (operation.status) { card.status = operation.status; if (card.status !== previousStatus) card.position = nextPosition(cards, card.status); }
      if (operation.priority) card.priority = operation.priority;
      if (operation.clearAssignee) { card.assigneeUid = undefined; card.assignee = undefined; }
      else if (operation.assignee) {
        const assignee = resolveAssigneeByName(operation.assignee, participants);
        card.assigneeUid = assignee?.rtcUid;
        card.assignee = assignee?.displayName;
      }
      if (operation.clearDueDate) card.dueDate = undefined;
      else if (operation.dueDate) card.dueDate = normalizeDueDate(operation.dueDate);
      if (operation.tags) card.tags = normalizeTags(operation.tags);
    }
    card.version = existing.version + 1;
    card.updatedAt = new Date().toISOString();
    if (!await this.store.updateKanbanCard(card, existing.version)) throw conflict();
    const action: KanbanActivity["action"] = card.status !== previousStatus ? "moved" : operation.type === "add_tags" ? "tagged" : operation.assignee || operation.clearAssignee ? "assigned" : "updated";
    const detail = action === "moved" ? `Moved via Copilot to ${statusLabel(card.status)}`
      : action === "assigned" ? card.assignee ? `Assigned via Copilot to ${card.assignee}` : "Cleared assignee via Copilot"
        : action === "tagged" ? "Updated tags via Copilot" : "Updated via Copilot";
    const activity = await this.recordActivity(card, actor, "voice", action, detail);
    return { result: { cardId: card.id, title: card.title, status: card.status }, activity };
  }

  private async requireActor(roomId: string, actorUid: string) {
    const room = await this.store.getRoom(roomId);
    if (!room || room.status !== "open") throw Object.assign(new Error("Meeting room is not open"), { statusCode: 409 });
    const actor = (await this.store.listParticipants(roomId)).find((participant) => participant.rtcUid === actorUid && participant.role !== "ai");
    if (!actor) throw Object.assign(new Error("Board participant is not in this room"), { statusCode: 403 });
    return actor;
  }

  private async recordActivity(card: KanbanCard, actor: ParticipantRecord, source: KanbanActivity["source"], action: KanbanActivity["action"], detail: string) {
    const activity: KanbanActivity = {
      id: randomUUID(), roomId: card.roomId, cardId: action === "deleted" ? undefined : card.id, cardTitle: card.title,
      action, actorUid: actor.rtcUid, actorName: actor.displayName, source, detail, createdAt: new Date().toISOString()
    };
    await this.store.appendKanbanActivity(activity);
    return activity;
  }

  private async publishBoard(roomId: string, activity: KanbanActivity) {
    const [cards, activities] = await Promise.all([this.store.listKanbanCards(roomId), this.store.listKanbanActivities(roomId, 50)]);
    await this.events.publish(roomId, "kanban.board.updated", { cards, activities, activity });
  }
}

function resolveCard(cards: KanbanCard[], cardId?: string, cardQuery?: string) {
  const exactId = cardId?.trim();
  if (exactId) {
    const card = cards.find((candidate) => candidate.id === exactId);
    if (card) return card;
  }

  const query = normalizeTitle(cardQuery);
  if (!query) throw Object.assign(new Error("The requested board card could not be identified"), { statusCode: 404 });
  const ranked = cards
    .map((card) => ({ card, score: titleMatchScore(card.title, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || (second && best.score - second.score < 80)) {
    throw Object.assign(new Error("The requested board card is ambiguous or could not be identified"), { statusCode: 409 });
  }
  return best.card;
}

function titleMatchScore(title: string, normalizedQuery: string) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return 0;
  if (normalizedTitle === normalizedQuery) return 1_000;
  if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
    return 820 + Math.min(normalizedQuery.length, normalizedTitle.length);
  }

  const titleTokenSet = new Set(titleTokensOf(normalizedTitle));
  const queryTokens = titleTokensOf(normalizedQuery);
  const overlap = queryTokens.filter((token) => titleTokenSet.has(token)).length;
  if (overlap === 0) return 0;
  const coverage = overlap / queryTokens.length;
  const compactness = overlap / titleTokenSet.size;
  if (coverage < 0.5 || compactness < 0.25) return 0;
  return 500 + Math.round(coverage * 180 + compactness * 100);
}

function normalizeTitle(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleTokensOf(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function resolveAssigneeByUid(uid: string | undefined, participants: ParticipantRecord[]) {
  if (!uid) return undefined;
  const assignee = participants.find((participant) => participant.rtcUid === uid && participant.role !== "ai");
  if (!assignee) throw Object.assign(new Error("The selected assignee is not a meeting participant"), { statusCode: 400 });
  return assignee;
}

function resolveAssigneeByName(value: string | undefined, participants: ParticipantRecord[]) {
  const name = value?.trim();
  if (!name) return undefined;
  const matches = participants.filter((participant) => participant.role !== "ai" && participant.displayName.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (matches.length !== 1) throw new Error("The requested assignee is not an unambiguous meeting participant");
  return matches[0];
}

function requiredText(value: string | undefined, label: string, max: number) {
  const cleaned = optionalText(value, max);
  if (!cleaned) throw Object.assign(new Error(`${label} is required`), { statusCode: 400 });
  return cleaned;
}

function optionalText(value: string | undefined, max: number) {
  return (value ?? "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeTags(tags: string[] | undefined) {
  return [...new Set((tags ?? []).map((tag) => optionalText(tag, 24).toLocaleLowerCase()).filter(Boolean))].slice(0, 6);
}

function normalizeDueDate(value: string | undefined) {
  if (!value) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw Object.assign(new Error("Due date must use YYYY-MM-DD"), { statusCode: 400 });
  }
  return value;
}

function nextPosition(cards: KanbanCard[], status: KanbanStatus) {
  return Math.max(0, ...cards.filter((card) => card.status === status).map((card) => card.position)) + 1_000;
}

function finitePosition(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) throw Object.assign(new Error("Card position is invalid"), { statusCode: 400 });
  return value;
}

function statusLabel(status: KanbanStatus) { return status === "in_progress" ? "In progress" : status[0].toUpperCase() + status.slice(1); }

function conflict() { return Object.assign(new Error("This card changed in another session. Refresh and try again."), { statusCode: 409 }); }

function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 240) : "The board command could not be completed"; }
