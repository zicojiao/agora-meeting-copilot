import type { CopilotTurn } from "@/lib/meeting-api";
import { copilotName } from "@/lib/product";
import {
  MessageType,
  TurnStatus,
  type AgentTranscription,
  type TranscriptHelperItem,
  type UserTranscription
} from "agora-agent-client-toolkit";

export type CopilotTurnInput = Omit<CopilotTurn, "id" | "roomId" | "createdAt"> & { createdAt?: string };

const maxSnapshotScanLength = 4000;

export function parseCopilotTurn(payload: Record<string, unknown>, names: Record<string, string>): CopilotTurnInput | null {
  if (payload.object === "user.transcription" && payload.final === true) {
    const uid = String(payload.user_id ?? "unknown");
    if (!uid || uid === "unknown" || uid === "0") return null;
    return {
      agentTurnId: Number(payload.turn_id ?? 0),
      turnSequence: Number(payload.stream_id ?? 0),
      speakerUid: uid,
      speakerName: names[uid] || `Guest ${uid}`,
      role: "user",
      text: String(payload.text ?? "").trim(),
      language: typeof payload.language === "string" ? payload.language : undefined,
      status: "final"
    };
  }
  if (payload.object === "assistant.transcription" && Number(payload.turn_status ?? 0) !== 0) {
    return {
      agentTurnId: Number(payload.turn_id ?? 0),
      turnSequence: Number(payload.stream_id ?? 0),
      speakerUid: "900001",
      speakerName: copilotName,
      role: "assistant",
      text: normalizeCumulativeTranscript(String(payload.text ?? "")),
      language: typeof payload.language === "string" ? payload.language : undefined,
      status: Number(payload.turn_status) === 2 ? "interrupted" : "final"
    };
  }
  return null;
}

export function parseToolkitCopilotTurn(
  item: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>
): CopilotTurnInput | null {
  if (item.metadata?.object !== MessageType.AGENT_TRANSCRIPTION || item.status === TurnStatus.IN_PROGRESS) return null;
  return {
    agentTurnId: item.turn_id,
    turnSequence: item.stream_id,
    speakerUid: "900001",
    speakerName: copilotName,
    role: "assistant",
    text: normalizeCumulativeTranscript(item.text),
    language: item.metadata.language,
    status: item.status === TurnStatus.INTERRUPTED ? "interrupted" : "final",
    createdAt: Number.isFinite(item._time) ? new Date(item._time).toISOString() : undefined
  };
}

export function copilotTurnKey(turn: Pick<CopilotTurn, "agentTurnId" | "turnSequence" | "speakerUid" | "role">) {
  return `${turn.agentTurnId}:${turn.turnSequence}:${turn.speakerUid}:${turn.role}`;
}

export function copilotTurnFingerprint(turn: CopilotTurnInput) {
  return `${turn.turnSequence}:${turn.status}:${turn.language ?? ""}:${turn.text}`;
}

export function upsertCopilotTurn(turns: CopilotTurn[], incoming: CopilotTurn) {
  const normalizedIncoming = { ...incoming, text: normalizeTurnText(incoming) };
  const key = copilotTurnKey(normalizedIncoming);
  const existingRaw = turns.find((turn) => copilotTurnKey(turn) === key);
  const existing = existingRaw ? { ...existingRaw, text: normalizeTurnText(existingRaw) } : undefined;
  if (!existing) return [...turns, normalizedIncoming].sort(compareCreatedAt);

  const preferred = preferCopilotTurn(existing, normalizedIncoming);
  const next = turns.filter((turn) => copilotTurnKey(turn) !== key);
  return [...next, preferred].sort(compareCreatedAt);
}

export function collapseCopilotTurns(turns: CopilotTurn[]) {
  return turns.reduce<CopilotTurn[]>((current, turn) => upsertCopilotTurn(current, turn), []);
}

// GPT Live delivers a turn as the running concatenation of its own cumulative
// snapshots ("Hey, " + "Hey, what's up") instead of just the last one. Peel the
// leading snapshots off to recover the final one. Matching ignores whitespace so
// Chinese, which has no word spacing, collapses the same way English does.
export function normalizeCumulativeTranscript(text: string) {
  const trimmed = text.trim();
  const compact: string[] = [];
  const origin: number[] = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    if (/\s/.test(trimmed[index])) continue;
    compact.push(trimmed[index]);
    origin.push(index);
  }
  if (compact.length < 2 || compact.length > maxSnapshotScanLength) return collapseExactSentenceReplay(trimmed);

  const lengths: number[] = [];
  let start = 0;
  let chained = true;
  let hasStrictGrowth = false;
  for (;;) {
    const length = leadingSnapshotLength(compact, start);
    if (!length) break;
    const previousLength = lengths.at(-1);
    // A provider replay can repeat a snapshot after the chain has already
    // grown. Equal chunks before any growth are more likely real repeated speech.
    if (previousLength !== undefined && (length < previousLength || (length === previousLength && !hasStrictGrowth))) {
      chained = false;
      break;
    }
    if (previousLength !== undefined && length > previousLength) hasStrictGrowth = true;
    lengths.push(length);
    start += length;
  }
  if (!chained || !lengths.length || start >= compact.length) return collapseExactSentenceReplay(trimmed);
  const finalLength = compact.length - start;
  const lastSnapshotLength = lengths[lengths.length - 1];
  if (finalLength < lastSnapshotLength || (!hasStrictGrowth && finalLength === lastSnapshotLength)) return collapseExactSentenceReplay(trimmed);
  return collapseExactSentenceReplay(trimmed.slice(origin[start]));
}

function collapseExactSentenceReplay(text: string) {
  const match = text.match(/^(.{2,}[.!?。！？])\s*\1$/u);
  return match?.[1] ?? text;
}

function leadingSnapshotLength(compact: string[], start: number) {
  const anchor = compact[start];
  for (let index = start + 1; index * 2 - start <= compact.length; index += 1) {
    if (compact[index] !== anchor) continue;
    const length = index - start;
    let offset = 1;
    while (offset < length && compact[start + offset] === compact[index + offset]) offset += 1;
    if (offset === length) return length;
  }
  return 0;
}

function normalizeTurnText(turn: Pick<CopilotTurn, "role" | "text">) {
  return turn.role === "assistant" ? normalizeCumulativeTranscript(turn.text) : turn.text.trim();
}

function preferCopilotTurn(existing: CopilotTurn, incoming: CopilotTurn) {
  if (existing.role !== "assistant") return incoming;
  const existingText = existing.text.trim();
  const incomingText = incoming.text.trim();
  if (incomingText.length < existingText.length) return existing;
  return {
    ...incoming,
    id: existing.id,
    createdAt: existing.createdAt < incoming.createdAt ? existing.createdAt : incoming.createdAt
  };
}

function compareCreatedAt(left: CopilotTurn, right: CopilotTurn) {
  return left.createdAt.localeCompare(right.createdAt);
}
