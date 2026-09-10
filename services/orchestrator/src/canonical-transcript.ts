import { collapseCopilotTurns } from "./copilot-turns.js";
import type { CopilotTurn, MeetingTranscriptSegment, RoomRecord } from "./domain.js";
import { COPILOT_NAME, isCopilotDisplayName } from "./product.js";

export const COPILOT_RTC_UID = "900001";

/**
 * Human speech is owned by Agora STT. Copilot speech is owned by GPT Live's
 * assistant transcript. Keeping that boundary here prevents the agent's RTC
 * audio from being transcribed a second time with different words.
 */
export function buildCanonicalTranscriptSegments(
  room: RoomRecord,
  segments: MeetingTranscriptSegment[],
  copilotTurns: CopilotTurn[]
) {
  const roomStart = Date.parse(room.createdAt);
  const humanSegments = segments.filter((segment) => !isCopilotSegment(segment));
  const assistantSegments = collapseCopilotTurns(copilotTurns)
    .filter((turn) => turn.role === "assistant" && turn.text.trim())
    .map<MeetingTranscriptSegment>((turn) => ({
      id: turn.id,
      roomId: turn.roomId,
      transcriptionSessionId: "gpt-live",
      sequence: 0,
      sourceSentenceId: `gpt-live:${turn.agentTurnId}:${turn.turnSequence}`,
      identityQuality: "source",
      speakerUid: COPILOT_RTC_UID,
      speakerName: COPILOT_NAME,
      text: turn.text.trim(),
      language: turn.language,
      startMs: elapsedMs(turn.createdAt, roomStart),
      durationMs: 0,
      createdAt: turn.createdAt
    }));

  return [...humanSegments, ...assistantSegments]
    .sort((left, right) => left.startMs - right.startMs || left.createdAt.localeCompare(right.createdAt))
    .map((segment, index) => ({ ...segment, sequence: index + 1 }));
}

export function isCopilotSegment(segment: Pick<MeetingTranscriptSegment, "speakerUid" | "speakerName">) {
  return segment.speakerUid === COPILOT_RTC_UID || isCopilotDisplayName(segment.speakerName);
}

function elapsedMs(createdAt: string, roomStart: number) {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) && Number.isFinite(roomStart) ? Math.max(0, timestamp - roomStart) : 0;
}
