import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { MeetingNotesDocument, MeetingTranscriptSegment } from "../src/domain.js";
import type { MeetingNotesRuntime } from "../src/runtime/meeting-notes-runtime.js";
import type { MeetingTranscriptionRuntime, MeetingTranscriptionRuntimeStatus, StartMeetingTranscriptionInput } from "../src/runtime/meeting-transcription-runtime.js";
import type { RuntimeStatus, StartVoiceRuntimeInput, VoiceRuntimeAdapter } from "../src/runtime/voice-runtime.js";
import type { MeetingPublisher } from "../src/meeting-publisher.js";
import { MemoryStore } from "../src/store/memory-store.js";

const config = {
  NODE_ENV: "test",
  PORT: 8787,
  PUBLIC_APP_URL: "http://localhost:3000",
  ALLOWED_ORIGINS: "http://localhost:3000",
  STORAGE_DRIVER: "memory",
  DATABASE_URL: undefined,
  CAPABILITY_SECRET: "test-capability-secret-at-least-24",
  WEBHOOK_SECRET: "test-webhook-secret",
  AGORA_APP_ID: "a".repeat(32),
  AGORA_APP_CERTIFICATE: "b".repeat(32),
  AGORA_CUSTOMER_ID: undefined,
  AGORA_CUSTOMER_SECRET: undefined,
  AGORA_STT_PUBLISHER_UID: "900003",
  AGORA_STT_LANGUAGES: "en-US",
  AGORA_STT_MAX_IDLE_SECONDS: 3600,
  OPENAI_API_KEY: "sk-test-key-long-enough-for-tests",
  OPENAI_GPT_LIVE_GREETING: undefined,
  OPENAI_GPT_LIVE_DELEGATION_MODEL: "gpt-5.5",
  GPT_LIVE_PROXY_PUBLIC_URL: undefined,
  RAILWAY_PUBLIC_DOMAIN: undefined,
  OPENAI_ANALYSIS_MODEL: "gpt-5.4-mini",
  ROOM_TTL_HOURS: 24,
  FEISHU_PUBLISH_ENABLED: false,
  gptLiveProxyPublicUrl: "ws://127.0.0.1:8787",
  allowedOrigins: ["http://localhost:3000"],
  agoraSttLanguages: ["en-US"],
  agoraSttEnabled: false,
  roomTtlMs: 86_400_000,
  feishu: null
} satisfies Config;

class FakeRuntime implements VoiceRuntimeAdapter {
  calls: string[] = [];
  async start(input: StartVoiceRuntimeInput): Promise<RuntimeStatus> { this.calls.push(`start:${input.roomId}`); return { agentId: "agent-test", status: "standby" }; }
  async stop(roomId: string, agentId?: string) { this.calls.push(`stop:${roomId}:${agentId ?? "local"}`); }
  async getStatus(): Promise<RuntimeStatus> { return { agentId: "agent-test", status: "standby" }; }
  async setConversationMode(roomId: string, mode: "standby" | "focused") { this.calls.push(`mode:${roomId}:${mode}`); }
  async think(roomId: string, instruction: string) { this.calls.push(`think:${roomId}:${instruction}`); }
  async say(roomId: string, text: string) { this.calls.push(`say:${roomId}:${text}`); }
  async interrupt(roomId: string) { this.calls.push(`interrupt:${roomId}`); }
  async getHistory() { return []; }
}

class FakeTranscriptionRuntime implements MeetingTranscriptionRuntime {
  calls: string[] = [];
  async start(input: StartMeetingTranscriptionInput): Promise<MeetingTranscriptionRuntimeStatus> {
    this.calls.push(`start:${input.roomId}`);
    return { providerSessionId: "stt-agent-test", status: "active", providerStatus: "RUNNING" };
  }
  async getStatus(providerSessionId: string): Promise<MeetingTranscriptionRuntimeStatus> { return { providerSessionId, status: "active", providerStatus: "RUNNING" }; }
  async stop(providerSessionId: string): Promise<MeetingTranscriptionRuntimeStatus> { this.calls.push(`stop:${providerSessionId}`); return { providerSessionId, status: "stopped", providerStatus: "STOPPED" }; }
  reconcile(providerSessionId: string) { return this.getStatus(providerSessionId); }
}

class FakeNotesRuntime implements MeetingNotesRuntime {
  calls: string[] = [];
  async generate(kind: "live" | "final", segments: MeetingTranscriptSegment[]): Promise<MeetingNotesDocument> {
    this.calls.push(`${kind}:${segments.length}`);
    const first = segments[0];
    const evidence = first ? [{ segmentId: first.id, speakerUid: first.speakerUid, speakerName: first.speakerName, startMs: first.startMs }] : [];
    return { title: "Launch meeting", overview: "The team discussed the launch.", topics: ["Launch"], decisions: evidence.length ? [{ text: "Ship the demo.", evidence }] : [], actionItems: [], openQuestions: [], keyPoints: [], sourceQuality: segments.length ? "good" : "insufficient" };
  }
}

class FailingPublisher implements MeetingPublisher {
  calls: string[] = [];

  async publish(roomId: string): Promise<never> {
    this.calls.push(roomId);
    throw new Error("Feishu is temporarily unavailable");
  }
}

describe("orchestrator API", () => {
  let runtime: FakeRuntime;

  beforeEach(() => { runtime = new FakeRuntime(); });

  it("creates a room, separates host and guest powers, and starts one Copilot", async () => {
    const { app } = await buildApp(config, { store: new MemoryStore(), runtime });
    const created = await app.inject({ method: "POST", url: "/rooms" });
    const { roomId, hostSecret } = created.json();
    expect(created.statusCode).toBe(201);
    expect(hostSecret).toBeTruthy();

    const host = await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Host", hostSecret } });
    const guest = await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Guest" } });
    expect(host.json().role).toBe("host");
    expect(guest.json().role).toBe("guest");
    expect(host.json().rtcToken).toBeTruthy();
    expect(host.json().rtmToken).toBeTruthy();

    const denied = await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/start`, headers: auth(guest.json().capability) });
    expect(denied.statusCode).toBe(403);
    const started = await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/start`, headers: auth(host.json().capability) });
    expect(started.statusCode).toBe(202);
    expect(runtime.calls.filter((call) => call.startsWith("start:"))).toHaveLength(1);

    const startedAgain = await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/start`, headers: auth(host.json().capability) });
    expect(startedAgain.statusCode).toBe(202);
    expect(runtime.calls.filter((call) => call.startsWith("start:"))).toHaveLength(1);

    const guestThink = await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/think`, headers: auth(guest.json().capability), payload: { instruction: "Create a board card." } });
    expect(guestThink.statusCode).toBe(403);
    const hostThink = await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/think`, headers: auth(host.json().capability), payload: { instruction: "Call create_board_card for a canary card." } });
    expect(hostThink.statusCode).toBe(202);
    expect(runtime.calls).toContain(`think:${roomId}:Call create_board_card for a canary card.`);

    const guestLeft = await app.inject({ method: "POST", url: `/rooms/${roomId}/participants/leave`, headers: auth(guest.json().capability) });
    expect(guestLeft.statusCode).toBe(202);
    const afterGuestLeft = await app.inject({ method: "GET", url: `/rooms/${roomId}`, headers: auth(host.json().capability) });
    expect(afterGuestLeft.json().participants.map((participant: { displayName: string }) => participant.displayName)).toEqual(["Host", "Copilot"]);

    const stopped = await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/stop`, headers: auth(host.json().capability) });
    expect(stopped.statusCode).toBe(202);
    const afterStop = await app.inject({ method: "GET", url: `/rooms/${roomId}`, headers: auth(host.json().capability) });
    expect(afterStop.json().participants.map((participant: { displayName: string }) => participant.displayName)).toEqual(["Host"]);
    await app.close();
  });

  it("opens focused mode from spoken wake words and stores final voice turns once", async () => {
    const { app } = await buildApp(config, { store: new MemoryStore(), runtime });
    const { roomId, hostSecret } = (await app.inject({ method: "POST", url: "/rooms" })).json();
    const joined = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Host", hostSecret } })).json();
    await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/start`, headers: auth(joined.capability) });
    const payload = { agentTurnId: 1, turnSequence: 1, speakerUid: String(joined.rtcUid), speakerName: "Host", role: "user", text: "Copilot, what is next?", status: "final" };
    const first = await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(joined.capability), payload });
    const second = await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(joined.capability), payload });
    expect(first.json().accepted).toBe(true);
    expect(second.json().accepted).toBe(false);
    const assistant = { agentTurnId: 2, speakerUid: "900001", speakerName: "Ignored", role: "assistant", status: "final" };
    const repeated = "It sounds It sounds like you It sounds like you started to It sounds like you started to ask something. It sounds like you started to ask something. Could It sounds like you started to ask something. Could you repeat It sounds like you started to ask something. Could you repeat that? It sounds like you started to ask something. Could you repeat that?";
    const assistantPartial = await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(joined.capability), payload: { ...assistant, turnSequence: 4, text: "It sounds" } });
    const assistantFinal = await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(joined.capability), payload: { ...assistant, turnSequence: 4, text: repeated } });
    const assistantLatePartial = await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(joined.capability), payload: { ...assistant, turnSequence: 4, text: "It sounds like you" } });
    expect(assistantPartial.json().accepted).toBe(true);
    expect(assistantFinal.json().accepted).toBe(true);
    expect(assistantLatePartial.json().accepted).toBe(false);
    const snapshot = await app.inject({ method: "GET", url: `/rooms/${roomId}`, headers: auth(joined.capability) });
    expect(snapshot.json().copilotTurns).toHaveLength(2);
    expect(snapshot.json().copilotTurns.filter((turn: { agentTurnId: number }) => turn.agentTurnId === 1)).toHaveLength(1);
    expect(snapshot.json().copilotTurns.find((turn: { role: string }) => turn.role === "assistant")).toMatchObject({
      speakerName: "Copilot",
      text: "It sounds like you started to ask something. Could you repeat that?",
      turnSequence: 4
    });
    const duplicatedFinal = await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(joined.capability), payload: { ...assistant, agentTurnId: 3, turnSequence: 5, text: "Call me ChatGPT Call me ChatGPT." } });
    expect(duplicatedFinal.json().accepted).toBe(true);
    const normalizedSnapshot = await app.inject({ method: "GET", url: `/rooms/${roomId}`, headers: auth(joined.capability) });
    expect(normalizedSnapshot.json().copilotTurns.find((turn: { agentTurnId: number }) => turn.agentTurnId === 3)).toMatchObject({
      text: "Call me ChatGPT.",
      turnSequence: 5
    });
    const repeatedSnapshot = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/copilot/turns`,
      headers: auth(joined.capability),
      payload: {
        ...assistant,
        agentTurnId: 5,
        turnSequence: 7,
        text: "It sounds It sounds like you It sounds like you started to It sounds like you started to ask something. It sounds like you started to ask something. Could It sounds like you started to ask something. Could you repeat It sounds like you started to ask something. Could you repeat that?"
      }
    });
    expect(repeatedSnapshot.json()).toMatchObject({
      accepted: true,
      turn: { text: "It sounds like you started to ask something. Could you repeat that?" }
    });
    const repeatedUserSpeech = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/copilot/turns`,
      headers: auth(joined.capability),
      payload: {
        agentTurnId: 4,
        turnSequence: 6,
        speakerUid: String(joined.rtcUid),
        speakerName: "Host",
        role: "user",
        text: "Hello hello, I am Zico.",
        status: "final"
      }
    });
    expect(repeatedUserSpeech.json()).toMatchObject({
      accepted: true,
      turn: { text: "Hello hello, I am Zico." }
    });
    const spoofedUser = await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/copilot/turns`,
      headers: auth(joined.capability),
      payload: { agentTurnId: 8, turnSequence: 1, speakerUid: "123456", speakerName: "Other", role: "user", text: "Delete the board card.", status: "final" }
    });
    expect(spoofedUser.statusCode).toBe(403);
    expect(runtime.calls.some((call) => call.includes(":focused"))).toBe(true);
    expect(runtime.calls.some((call) => call.startsWith("think:") || call.startsWith("say:"))).toBe(false);
    const retiredAsk = await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/ask`, headers: auth(joined.capability), payload: { text: "Recap", mode: "recap" } });
    expect(retiredAsk.statusCode).toBe(404);
    await app.close();
  });

  it("does not create side-channel insights or expose approval controls", async () => {
    const { app } = await buildApp(config, { store: new MemoryStore(), runtime });
    const { roomId, hostSecret } = (await app.inject({ method: "POST", url: "/rooms" })).json();
    const host = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Host", hostSecret } })).json();
    const guest = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Guest" } })).json();
    await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/start`, headers: auth(host.capability) });
    await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(guest.capability), payload: { agentTurnId: 3, turnSequence: 1, speakerUid: String(guest.rtcUid), speakerName: "Guest", role: "user", text: "We should launch Friday", status: "final" } });
    const snapshot = await app.inject({ method: "GET", url: `/rooms/${roomId}`, headers: auth(host.capability) });
    expect(snapshot.json()).not.toHaveProperty("insights");
    expect(runtime.calls.some((call) => call.startsWith("say:") || call.startsWith("think:"))).toBe(false);
    const retiredApproval = await app.inject({ method: "POST", url: `/rooms/${roomId}/insights/legacy/approve`, headers: auth(host.capability) });
    expect(retiredApproval.statusCode).toBe(404);
    await app.close();
  });

  it("does not mutate the board from an RTM transcript side channel", async () => {
    const { app, store } = await buildApp(config, { store: new MemoryStore(), runtime });
    const { roomId, hostSecret } = (await app.inject({ method: "POST", url: "/rooms" })).json();
    const host = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Zico", hostSecret } })).json();

    await app.inject({
      method: "POST",
      url: `/rooms/${roomId}/copilot/turns`,
      headers: auth(host.capability),
      payload: { agentTurnId: 31, turnSequence: 1, speakerUid: String(host.rtcUid), speakerName: "Zico", role: "user", text: "Copilot, create a board card for the launch checklist.", status: "final" }
    });
    const snapshot = await app.inject({ method: "GET", url: `/rooms/${roomId}`, headers: auth(host.capability) });
    expect(snapshot.json().kanbanCards).toEqual([]);
    expect((await store.listEventsAfter(roomId, 0)).map((event) => event.type)).not.toContain("kanban.board.updated");
    await app.close();
  });

  it("lets people create, assign, move, version, and delete board cards safely", async () => {
    const { app } = await buildApp(config, { store: new MemoryStore(), runtime });
    const { roomId, hostSecret } = (await app.inject({ method: "POST", url: "/rooms" })).json();
    const host = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Zico", hostSecret } })).json();
    const guest = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Ada" } })).json();

    const created = await app.inject({
      method: "POST", url: `/rooms/${roomId}/kanban/cards`, headers: auth(host.capability),
      payload: { title: "Prepare launch brief", notes: "Include customer proof.", priority: "high", assigneeUid: String(guest.rtcUid), dueDate: "2026-08-25", tags: ["launch"] }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().card).toMatchObject({ title: "Prepare launch brief", priority: "high", assigneeUid: String(guest.rtcUid), assignee: "Ada", dueDate: "2026-08-25", version: 1, createdByName: "Zico" });
    const card = created.json().card;

    const updated = await app.inject({
      method: "PATCH", url: `/rooms/${roomId}/kanban/cards/${card.id}`, headers: auth(guest.capability),
      payload: { expectedVersion: 1, status: "in_progress", priority: "urgent", assigneeUid: String(host.rtcUid) }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().card).toMatchObject({ status: "in_progress", priority: "urgent", assignee: "Zico", version: 2 });

    const stale = await app.inject({
      method: "PATCH", url: `/rooms/${roomId}/kanban/cards/${card.id}`, headers: auth(host.capability),
      payload: { expectedVersion: 1, status: "done" }
    });
    expect(stale.statusCode).toBe(409);

    const invalidDate = await app.inject({
      method: "PATCH", url: `/rooms/${roomId}/kanban/cards/${card.id}`, headers: auth(host.capability),
      payload: { expectedVersion: 2, dueDate: "2026-02-30" }
    });
    expect(invalidDate.statusCode).toBe(400);

    const deniedDelete = await app.inject({ method: "DELETE", url: `/rooms/${roomId}/kanban/cards/${card.id}`, headers: auth(guest.capability) });
    expect(deniedDelete.statusCode).toBe(403);
    const deleted = await app.inject({ method: "DELETE", url: `/rooms/${roomId}/kanban/cards/${card.id}`, headers: auth(host.capability) });
    expect(deleted.statusCode).toBe(204);

    const snapshot = await app.inject({ method: "GET", url: `/rooms/${roomId}`, headers: auth(host.capability) });
    expect(snapshot.json().kanbanCards).toEqual([]);
    expect(snapshot.json().kanbanActivities).toMatchObject([
      { action: "deleted", actorName: "Zico", source: "manual" },
      { action: "moved", actorName: "Ada", source: "manual" },
      { action: "created", actorName: "Zico", source: "manual" }
    ]);
    await app.close();
  });

  it("runs room transcription independently, deduplicates final segments, and publishes final artifacts", async () => {
    const transcriptionRuntime = new FakeTranscriptionRuntime();
    const notesRuntime = new FakeNotesRuntime();
    const publisher = new FailingPublisher();
    const { app } = await buildApp(config, { store: new MemoryStore(), runtime, transcriptionRuntime, notesRuntime, publisher });
    const { roomId, hostSecret } = (await app.inject({ method: "POST", url: "/rooms" })).json();
    const host = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Zico", hostSecret } })).json();
    const guest = (await app.inject({ method: "POST", url: `/rooms/${roomId}/participants`, payload: { displayName: "Ada" } })).json();
    await app.inject({ method: "POST", url: `/rooms/${roomId}/agent/start`, headers: auth(host.capability) });

    const started = await app.inject({ method: "POST", url: `/rooms/${roomId}/transcription/start`, headers: auth(guest.capability) });
    expect(started.statusCode).toBe(202);
    expect(transcriptionRuntime.calls).toEqual([`start:${roomId}`]);
    const sessionId = started.json().transcription.id;
    const segment = { transcriptionSessionId: sessionId, sourceSentenceId: "sentence-1", speakerUid: String(guest.rtcUid), text: "We should ship the demo.", language: "en-US", startMs: 1200, durationMs: 900 };
    const first = await app.inject({ method: "POST", url: `/rooms/${roomId}/transcript-segments`, headers: auth(host.capability), payload: segment });
    const duplicate = await app.inject({ method: "POST", url: `/rooms/${roomId}/transcript-segments`, headers: auth(guest.capability), payload: segment });
    expect(first.json().accepted).toBe(true);
    expect(first.json().segment.speakerName).toBe("Ada");
    expect(duplicate.json().accepted).toBe(false);
    const ignoredCopilotStt = await app.inject({ method: "POST", url: `/rooms/${roomId}/transcript-segments`, headers: auth(host.capability), payload: { transcriptionSessionId: sessionId, sourceSentenceId: "copilot-stt-copy", speakerUid: "900001", text: "Imprecise STT copy.", language: "en-US", startMs: 2400, durationMs: 900 } });
    expect(ignoredCopilotStt.json()).toEqual({ accepted: false, ignored: "copilot_transcript_owned_by_gpt_live" });
    await app.inject({ method: "POST", url: `/rooms/${roomId}/copilot/turns`, headers: auth(host.capability), payload: { agentTurnId: 9, turnSequence: 1, speakerUid: "900001", speakerName: "Copilot", role: "assistant", text: "Direct Copilot answer.", status: "final" } });

    const ended = await app.inject({ method: "POST", url: `/rooms/${roomId}/end`, headers: auth(host.capability) });
    expect(ended.statusCode).toBe(202);
    expect(ended.json().room.status).toBe("ended");
    expect(ended.json().finalNotes.status).toBe("completed");
    expect(transcriptionRuntime.calls).toContain("stop:stt-agent-test");
    expect(notesRuntime.calls).toContain("final:2");

    const status = await app.inject({ method: "GET", url: `/rooms/${roomId}/artifacts/status` });
    expect(status.statusCode).toBe(200);
    expect(status.json().transcriptSegments).toHaveLength(1);
    expect(status.json().copilotTurns).toHaveLength(1);
    const transcript = await app.inject({ method: "GET", url: `/rooms/${roomId}/artifacts/transcript.md` });
    expect(transcript.body).toContain("Ada");
    expect(transcript.body).toContain("We should ship the demo.");
    expect(transcript.body).toContain("Copilot");
    expect(transcript.body).toContain("Direct Copilot answer.");
    expect(transcript.body).not.toContain("Imprecise STT copy.");
    const notes = await app.inject({ method: "GET", url: `/rooms/${roomId}/artifacts/notes.md` });
    expect(notes.body).toContain("## Overview");
    expect(notes.body).toContain("## Topics");
    expect(notes.body).toContain("## Decisions");
    expect(notes.body).toContain("## Source quality");
    const archive = await app.inject({ method: "GET", url: `/rooms/${roomId}/artifacts/all.zip` });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers["content-type"]).toContain("application/zip");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(publisher.calls).toEqual([roomId]);
    await app.close();
  });
});

function auth(capability: string) { return { authorization: `Bearer ${capability}` }; }
