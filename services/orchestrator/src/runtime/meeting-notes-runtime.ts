import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Config } from "../config.js";
import type { MeetingNotesDocument, MeetingTranscriptSegment } from "../domain.js";
import type { OpenAiKeyStore } from "../openai-key-store.js";

const evidenceSchema = z.object({
  segmentId: z.string(),
  speakerUid: z.string(),
  speakerName: z.string(),
  startMs: z.number().int().nonnegative()
});

const notesSchema = z.object({
  title: z.string(),
  overview: z.string(),
  topics: z.array(z.string()),
  decisions: z.array(z.object({ text: z.string(), evidence: z.array(evidenceSchema) })),
  actionItems: z.array(z.object({
    text: z.string(),
    owner: z.string(),
    due: z.string(),
    explicitness: z.enum(["explicit", "inferred"]),
    evidence: z.array(evidenceSchema)
  })),
  openQuestions: z.array(z.object({ text: z.string(), evidence: z.array(evidenceSchema) })),
  keyPoints: z.array(z.object({ text: z.string(), evidence: z.array(evidenceSchema) })),
  sourceQuality: z.enum(["good", "partial", "insufficient"])
});

type ParsedNotes = z.infer<typeof notesSchema>;

export interface MeetingNotesRuntime {
  generate(roomId: string, kind: "live" | "final", segments: MeetingTranscriptSegment[]): Promise<MeetingNotesDocument>;
}

export class OpenAIMeetingNotesRuntime implements MeetingNotesRuntime {
  constructor(private config: Config, private openAiKeys: OpenAiKeyStore) {}

  async generate(roomId: string, kind: "live" | "final", segments: MeetingTranscriptSegment[]) {
    if (!segments.length) return emptyNotes();
    const client = new OpenAI({ apiKey: this.openAiKeys.require(roomId) });
    const chunks = chunkSegments(segments, 36_000);
    if (chunks.length === 1) return this.summarize(client, kind, renderTranscript(chunks[0]), false, chunks[0]);

    const partials: MeetingNotesDocument[] = [];
    for (const chunk of chunks) partials.push(await this.summarize(client, "live", renderTranscript(chunk), false, chunk));
    return this.summarize(client, kind, JSON.stringify(partials), true, segments);
  }

  private async summarize(client: OpenAI, kind: "live" | "final", source: string, reducing: boolean, allowedSegments: MeetingTranscriptSegment[]) {
    const response = await client.responses.parse({
      model: this.config.OPENAI_ANALYSIS_MODEL,
      input: [
        {
          role: "system",
          content: meetingNotesPrompt(kind, reducing)
        },
        {
          role: "user",
          content: reducing ? `Merge these chunk summaries into one evidence-grounded meeting record:\n${source}` : `Meeting transcript:\n${source}`
        }
      ],
      text: { format: zodTextFormat(notesSchema, "meeting_notes") }
    });
    if (!response.output_parsed) throw new Error("OpenAI did not return structured meeting notes");
    return normalizeNotes(response.output_parsed, allowedSegments);
  }
}

export class NoopMeetingNotesRuntime implements MeetingNotesRuntime {
  async generate(_roomId: string, _kind: "live" | "final", segments: MeetingTranscriptSegment[]) {
    return segments.length ? {
      ...emptyNotes(),
      title: "Meeting summary",
      overview: "The meeting notes service is not configured in this environment.",
      sourceQuality: "partial" as const
    } : emptyNotes();
  }
}

export function meetingNotesPrompt(kind: "live" | "final", reducing: boolean) {
  const meetingStateInstruction = kind === "live"
    ? "The meeting is still in progress. Make the provisional status clear without adding generic filler."
    : "The meeting has ended. Write a retrospective record and never describe it as ongoing, live, or still in progress.";
  return `You create ${kind === "live" ? "live, provisional" : "final"} meeting notes from a canonical transcript.
${reducing ? "The input contains chunk summaries with evidence. Merge them without losing or inventing evidence." : "Each transcript line includes a segment ID, speaker identity, and timestamp."}
Write every human-readable note field in English, regardless of the language used in the transcript. Do not include a translation unless it is needed to preserve a proper name or technical term.
Keep people's names, product names, company names, acronyms, technical identifiers, and evidence speaker metadata in their original form.
Be concise and useful for coworkers.
Never invent a decision, owner, deadline, fact, or unresolved question. Mark an action item inferred only when the request is strongly implied; otherwise omit it.
Every decision, action item, open question, and key point must cite one or more evidence objects copied exactly from the source.
Use empty arrays when a section has no grounded content. Use an empty string for unknown owner or due date.
${meetingStateInstruction}`;
}

function renderTranscript(segments: MeetingTranscriptSegment[]) {
  return segments.map((segment) => {
    const evidence = JSON.stringify({ segmentId: segment.id, speakerUid: segment.speakerUid, speakerName: segment.speakerName, startMs: segment.startMs });
    return `${evidence} ${segment.speakerName}: ${segment.text}`;
  }).join("\n");
}

function chunkSegments(segments: MeetingTranscriptSegment[], maxCharacters: number) {
  const chunks: MeetingTranscriptSegment[][] = [];
  let current: MeetingTranscriptSegment[] = [];
  let size = 0;
  for (const segment of segments) {
    const segmentSize = segment.text.length + segment.speakerName.length + 180;
    if (current.length && size + segmentSize > maxCharacters) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += segmentSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function normalizeNotes(notes: ParsedNotes, segments: MeetingTranscriptSegment[]): MeetingNotesDocument {
  const evidenceById = new Map(segments.map((segment) => [segment.id, {
    segmentId: segment.id,
    speakerUid: segment.speakerUid,
    speakerName: segment.speakerName,
    startMs: segment.startMs
  }]));
  const trustedEvidence = (evidence: ParsedNotes["decisions"][number]["evidence"]) => [
    ...new Map(evidence.map((item) => evidenceById.get(item.segmentId)).filter((item) => item != null).map((item) => [item.segmentId, item])).values()
  ];
  return {
    ...notes,
    title: notes.title.trim() || "Meeting summary",
    overview: notes.overview.trim(),
    topics: notes.topics.map((topic) => topic.trim()).filter(Boolean),
    decisions: notes.decisions
      .map((item) => ({ ...item, evidence: trustedEvidence(item.evidence) }))
      .filter((item) => item.text.trim() && item.evidence.length),
    actionItems: notes.actionItems
      .map((item) => ({ ...item, evidence: trustedEvidence(item.evidence), owner: item.owner.trim() || undefined, due: item.due.trim() || undefined }))
      .filter((item) => item.text.trim() && item.evidence.length),
    openQuestions: notes.openQuestions
      .map((item) => ({ ...item, evidence: trustedEvidence(item.evidence) }))
      .filter((item) => item.text.trim() && item.evidence.length),
    keyPoints: notes.keyPoints
      .map((item) => ({ ...item, evidence: trustedEvidence(item.evidence) }))
      .filter((item) => item.text.trim() && item.evidence.length)
  };
}

function emptyNotes(): MeetingNotesDocument {
  return {
    title: "Meeting summary",
    overview: "There is not enough transcript content to generate a meeting summary yet.",
    topics: [],
    decisions: [],
    actionItems: [],
    openQuestions: [],
    keyPoints: [],
    sourceQuality: "insufficient"
  };
}
