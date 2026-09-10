import type { CopilotTurn } from "./domain.js";

// A normal multi-sentence GPT Live answer can exceed 4,000 characters because
// the transcript helper concatenates every growing snapshot into one string.
// Keep a bounded guard, but size it for the server's 8,000-character turn
// limit plus headroom so valid long answers are normalized before persistence.
const maxSnapshotScanLength = 16000;

export function copilotTurnKey(turn: Pick<CopilotTurn, "agentTurnId" | "turnSequence" | "speakerUid" | "role">) {
  return `${turn.agentTurnId}:${turn.turnSequence}:${turn.speakerUid}:${turn.role}`;
}

export function shouldReplaceCopilotTurn(existing: CopilotTurn, incoming: CopilotTurn) {
  if (existing.role !== "assistant") return false;
  const existingText = existing.text.trim();
  const incomingText = incoming.text.trim();
  if (incomingText !== existingText) return incomingText.length >= existingText.length;
  return existing.status !== incoming.status || existing.language !== incoming.language || existing.speakerName !== incoming.speakerName;
}

export function collapseCopilotTurns(turns: CopilotTurn[]) {
  const collapsed = new Map<string, CopilotTurn>();
  for (const original of turns) {
    const turn = {
      ...original,
      text: original.role === "assistant" ? normalizeCumulativeTranscript(original.text) : original.text.trim()
    };
    const key = copilotTurnKey(turn);
    const existing = collapsed.get(key);
    if (!existing) {
      collapsed.set(key, turn);
      continue;
    }
    if (shouldReplaceCopilotTurn(existing, turn)) {
      collapsed.set(key, {
        ...turn,
        id: existing.id,
        createdAt: existing.createdAt < turn.createdAt ? existing.createdAt : turn.createdAt
      });
    }
  }
  return [...collapsed.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
