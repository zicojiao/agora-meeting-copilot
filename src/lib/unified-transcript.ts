import type { CopilotTurn, MeetingTranscriptSegment } from "@/lib/meeting-api";
import { collapseCopilotTurns } from "@/lib/copilot-turns";
import { copilotName } from "@/lib/product";

const copilotUid = "900001";

export type UnifiedTranscriptEntry = {
  id: string;
  source: "meeting" | "copilot";
  speakerUid: string;
  speakerName: string;
  text: string;
  startMs: number;
  createdAt: string;
};

export function transcriptEntryKey(entry: Pick<UnifiedTranscriptEntry, "id" | "source">) {
  return `${entry.source}:${entry.id}`;
}

export function withoutLocallyClearedTranscriptEntries(
  entries: UnifiedTranscriptEntry[],
  clearedEntryKeys: ReadonlySet<string>
) {
  return entries.filter((entry) => !clearedEntryKeys.has(transcriptEntryKey(entry)));
}

export function visibleTranscriptEntries(entries: UnifiedTranscriptEntry[], captionsOn: boolean) {
  return captionsOn ? entries : entries.filter((entry) => entry.source === "copilot");
}

export function buildUnifiedTranscriptEntries(
  segments: MeetingTranscriptSegment[],
  copilotTurns: CopilotTurn[],
  roomCreatedAt?: string
) {
  const roomStart = parseTime(roomCreatedAt);
  const assistantTurns = collapseCopilotTurns(copilotTurns)
    .filter((turn) => turn.role === "assistant" && turn.text.trim())
    .map((turn) => ({
      id: turn.id,
      source: "copilot" as const,
      speakerUid: copilotUid,
      speakerName: copilotName,
      text: turn.text.trim(),
      startMs: elapsedMs(turn.createdAt, roomStart),
      createdAt: turn.createdAt
    }));

  const meetingEntries = segments
    .filter((segment) => !isCopilotCapture(segment))
    .map((segment) => ({
      id: segment.id,
      source: "meeting" as const,
      speakerUid: segment.speakerUid,
      speakerName: segment.speakerName,
      text: segment.text,
      startMs: segment.startMs,
      createdAt: segment.createdAt
    }));

  return [...meetingEntries, ...assistantTurns].sort((left, right) => {
    if (left.startMs !== right.startMs) return left.startMs - right.startMs;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function isCopilotCapture(segment: MeetingTranscriptSegment) {
  const normalizedName = segment.speakerName.trim().toLowerCase();
  return segment.speakerUid === copilotUid || normalizedName === "copilot" || normalizedName === copilotName.toLowerCase();
}

function elapsedMs(createdAt: string, roomStart: number) {
  const timestamp = parseTime(createdAt);
  return roomStart && timestamp ? Math.max(0, timestamp - roomStart) : 0;
}

function parseTime(value?: string) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
