import { strToU8, zipSync } from "fflate";
import { buildCanonicalTranscriptSegments } from "./canonical-transcript.js";
import type { CopilotTurn, MeetingNoteEvidence, MeetingNoteVersion, MeetingTranscriptSegment, RoomRecord } from "./domain.js";
import type { Store } from "./store/store.js";

export class MeetingArtifactsService {
  constructor(private store: Store) {}

  async status(roomId: string) {
    const { room, segments, copilotTurns, notes } = await this.requireEndedArtifacts(roomId);
    return {
      room: publicRoom(room),
      transcriptSegments: segments,
      copilotTurns,
      finalNotes: notes,
      downloads: {
        transcript: `/rooms/${encodeURIComponent(roomId)}/artifacts/transcript.md`,
        notes: `/rooms/${encodeURIComponent(roomId)}/artifacts/notes.md`,
        all: `/rooms/${encodeURIComponent(roomId)}/artifacts/all.zip`
      }
    };
  }

  async transcriptMarkdown(roomId: string) {
    const { room, segments, copilotTurns } = await this.requireEndedArtifacts(roomId);
    return buildTranscriptMarkdown(room, segments, copilotTurns);
  }

  async notesMarkdown(roomId: string) {
    const { room, notes } = await this.requireEndedArtifacts(roomId);
    return buildNotesMarkdown(room, notes);
  }

  async zip(roomId: string) {
    const transcript = await this.transcriptMarkdown(roomId);
    const notes = await this.notesMarkdown(roomId);
    return Buffer.from(zipSync({
      "meeting-transcript.md": strToU8(transcript),
      "meeting-notes.md": strToU8(notes)
    }, { level: 6 }));
  }

  private async requireEndedArtifacts(roomId: string) {
    const room = await this.store.getRoom(roomId);
    if (!room) throw notFound("Meeting room not found");
    if (room.expiresAt <= new Date().toISOString()) throw gone("Meeting artifacts have expired");
    if (room.status !== "ended") throw conflict("Meeting artifacts are available after the meeting ends");
    const [segments, copilotTurns, notes] = await Promise.all([
      this.store.listMeetingTranscriptSegments(roomId),
      this.store.listCopilotTurns(roomId),
      this.store.getLatestMeetingNoteVersion(roomId, "final")
    ]);
    return { room, segments, copilotTurns, notes };
  }
}

export function buildTranscriptMarkdown(room: RoomRecord, segments: MeetingTranscriptSegment[], copilotTurns: CopilotTurn[] = []) {
  const entries = buildCanonicalTranscriptSegments(room, segments, copilotTurns);
  const lines = [
    `# ${room.id} transcript`,
    "",
    `- Started: ${room.createdAt}`,
    `- Ended: ${room.endedAt || room.updatedAt}`,
    `- Turns: ${entries.length}`,
    "",
    "## Transcript",
    ""
  ];
  if (!entries.length) lines.push("_No speech was transcribed._");
  for (const entry of entries) {
    lines.push(`**${formatTime(entry.startMs)} · ${entry.speakerName}**`);
    lines.push("");
    lines.push(entry.text);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function buildNotesMarkdown(room: RoomRecord, notes: MeetingNoteVersion | null) {
  const document = notes?.document;
  const lines = [
    `# ${document?.title || `${room.id} meeting summary`}`,
    "",
    `- Started: ${room.createdAt}`,
    `- Ended: ${room.endedAt || room.updatedAt}`,
    `- Notes status: ${notesStatusLabel(notes?.status)}`,
    ""
  ];
  if (!document) {
    lines.push("The meeting summary could not be generated, but the transcript is still available for download.");
    return `${lines.join("\n").trim()}\n`;
  }
  if (document.overview) lines.push("## Overview", "", document.overview, "");
  appendStrings(lines, "Topics", document.topics);
  appendEvidenceItems(lines, "Decisions", document.decisions);
  appendEvidenceItems(lines, "Action items", document.actionItems.map((item) => ({
    text: `${item.text}${item.owner ? ` — Owner: ${item.owner}` : ""}${item.due ? ` — Due: ${item.due}` : ""}${item.explicitness === "inferred" ? " _(inferred)_" : ""}`,
    evidence: item.evidence
  })));
  appendEvidenceItems(lines, "Open questions", document.openQuestions);
  appendEvidenceItems(lines, "Key points", document.keyPoints);
  lines.push("## Source quality", "", sourceQualityLabel(document.sourceQuality), "");
  return `${lines.join("\n").trim()}\n`;
}

function notesStatusLabel(status?: string) {
  return ({ completed: "Completed", failed: "Generation failed", pending: "Generating" } as Record<string, string>)[status || ""] || "Unavailable";
}

function sourceQualityLabel(quality: "good" | "partial" | "insufficient") {
  return ({ good: "Good", partial: "Partial", insufficient: "Insufficient" })[quality];
}

function appendStrings(lines: string[], title: string, values: string[]) {
  if (!values.length) return;
  lines.push(`## ${title}`, "");
  for (const value of values) lines.push(`- ${value}`);
  lines.push("");
}

function appendEvidenceItems(lines: string[], title: string, values: Array<{ text: string; evidence: MeetingNoteEvidence[] }>) {
  if (!values.length) return;
  lines.push(`## ${title}`, "");
  for (const value of values) {
    const evidence = value.evidence.map((item) => `${formatTime(item.startMs)} ${item.speakerName}`).join(", ");
    lines.push(`- ${value.text}${evidence ? ` _(${evidence})_` : ""}`);
  }
  lines.push("");
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function publicRoom(room: RoomRecord) {
  const { hostSecretHash: _hostSecretHash, agentId: _agentId, ...safe } = room;
  return safe;
}

function notFound(message: string) { return Object.assign(new Error(message), { statusCode: 404 }); }
function conflict(message: string) { return Object.assign(new Error(message), { statusCode: 409 }); }
function gone(message: string) { return Object.assign(new Error(message), { statusCode: 410 }); }
