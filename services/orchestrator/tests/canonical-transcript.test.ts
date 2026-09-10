import { describe, expect, it } from "vitest";
import { buildCanonicalTranscriptSegments } from "../src/canonical-transcript.js";
import type { CopilotTurn, MeetingTranscriptSegment, RoomRecord } from "../src/domain.js";

const room: RoomRecord = {
  id: "meet-devx",
  status: "open",
  hostSecretHash: "hash",
  agentStatus: "standby",
  conversationMode: "standby",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:10.000Z",
  expiresAt: "2026-08-25T00:00:00.000Z"
};

const commonSegment = {
  roomId: room.id,
  transcriptionSessionId: "stt-1",
  sequence: 1,
  identityQuality: "source" as const,
  language: "en-US",
  durationMs: 600
};

describe("buildCanonicalTranscriptSegments", () => {
  it("uses Agora STT for people and GPT Live for Copilot", () => {
    const segments: MeetingTranscriptSegment[] = [
      { ...commonSegment, id: "human", sourceSentenceId: "human-1", speakerUid: "101", speakerName: "Zico", text: "What is next?", startMs: 1_000, createdAt: "2026-08-24T00:00:01.600Z" },
      { ...commonSegment, id: "ai-stt", sourceSentenceId: "ai-1", speakerUid: "900001", speakerName: "Copilot", text: "Wrong second recognition.", startMs: 2_000, createdAt: "2026-08-24T00:00:02.600Z" }
    ];
    const turns: CopilotTurn[] = [{
      id: "ai-direct",
      roomId: room.id,
      agentTurnId: 2,
      turnSequence: 1,
      speakerUid: "900001",
      speakerName: "Copilot",
      role: "assistant",
      text: "Direct GPT Live answer.",
      status: "final",
      createdAt: "2026-08-24T00:00:03.000Z"
    }];

    const canonical = buildCanonicalTranscriptSegments(room, segments, turns);

    expect(canonical.map((segment) => segment.text)).toEqual(["What is next?", "Direct GPT Live answer."]);
    expect(canonical.map((segment) => segment.sequence)).toEqual([1, 2]);
    expect(canonical[1]).toMatchObject({ transcriptionSessionId: "gpt-live", speakerUid: "900001", startMs: 3_000 });
  });

  it("never falls back to a second STT pass for Copilot audio", () => {
    const aiCapture: MeetingTranscriptSegment = {
      ...commonSegment,
      id: "ai-stt",
      sourceSentenceId: "ai-1",
      speakerUid: "900001",
      speakerName: "Copilot",
      text: "Wrong second recognition.",
      startMs: 2_000,
      createdAt: "2026-08-24T00:00:02.600Z"
    };

    expect(buildCanonicalTranscriptSegments(room, [aiCapture], [])).toEqual([]);
  });
});
