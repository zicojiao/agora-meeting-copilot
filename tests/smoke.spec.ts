import { expect, test, type Page } from "@playwright/test";
import { resolveParticipantProfile, resolveTranscriptSpeakerName } from "../src/lib/participant-profile";
import { isScreenShareCancellation, screenShareErrorMessage } from "../src/lib/agora-errors";
import { decodeAgoraSttMessage, encodeAgoraSttMessage } from "../src/lib/agora-stt";
import { mergeVisibleMeetingNotes } from "../src/lib/meeting-notes";
import { meetingBoardPath, meetingPath, meetingSummaryPath } from "../src/lib/meeting-routes";
import { buildRoomCode, isValidRoomCode, normalizeRoomCodeSuffix } from "../src/lib/room-code";
import { buildUnifiedTranscriptEntries, transcriptEntryKey, visibleTranscriptEntries, withoutLocallyClearedTranscriptEntries } from "../src/lib/unified-transcript";
import { normalizeCumulativeTranscript, parseCopilotTurn, parseToolkitCopilotTurn } from "../src/lib/copilot-turns";
import { removeLiveTranscript, shouldStartMeetingTranscription, shouldUseAgoraSttSegment, upsertLiveTranscript, type PartialTranscriptSegment } from "../src/hooks/use-meeting-transcription";
import { MessageType, TurnStatus } from "agora-agent-client-toolkit";
import { shouldSilenceCopilotTurnSubmissionError } from "../src/lib/copilot-errors";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-landscape", width: 844, height: 390 }
];

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/access", { data: { password: "devx", next: "/" } });
  expect(response.ok()).toBe(true);
});

test("private preview gate protects direct routes and uses a session-only cookie", async ({ context, page }) => {
  await context.clearCookies();
  await page.goto("/board?room=meet-playwright");

  await expect(page).toHaveURL(/\/access\?next=%2Fboard%3Froom%3Dmeet-playwright$/);
  await expect(page.getByRole("heading", { name: "Enter the private preview" })).toBeVisible();
  await expect(page.getByText("This unreleased build is restricted to the project team.", { exact: false })).toBeVisible();

  await page.getByLabel("Access password").fill("wrong");
  await page.getByRole("button", { name: "Unlock preview" }).click();
  await expect(page.locator("#access-error")).toHaveText("Incorrect access password");
  await expect(page).toHaveURL(/\/access/);

  await page.getByLabel("Access password").fill("devx");
  await page.getByRole("button", { name: "Unlock preview" }).click();
  await expect(page).toHaveURL(/\/board\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Join the board" })).toBeVisible();

  const cookie = (await context.cookies()).find((item) => item.name === "agora-demo-access");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", expires: -1 });

  await context.clearCookies();
  const artifact = await context.request.get("/api/meeting-artifacts/meet-playwright/transcript.md");
  expect(artifact.status()).toBe(401);
  expect(await artifact.json()).toEqual({ error: "Private preview access is required" });

  const staticAsset = await context.request.get("/agora-logo-mark.svg");
  expect(staticAsset.status()).toBe(200);
});

test("Agora STT protobuf keeps final identity and timing fields", () => {
  const encoded = encodeAgoraSttMessage({ uid: 205309, time: 1_750_000_000_000, words: [{ text: "Ship it.", isFinal: true }], durationMs: 840, dataType: "transcribe", culture: "en-US", textTs: 1_750_000_001_200, sentenceId: 1_750_000_000_000 });
  expect(decodeAgoraSttMessage(encoded)).toEqual({ speakerUid: "205309", text: "Ship it.", isFinal: true, language: "en-US", sentenceId: "1750000000000", sourceTimeMs: 1_750_000_000_000, durationMs: 840, textTimestampMs: 1_750_000_001_200 });
});

test("live transcript revisions keep finalizing sentences stable", () => {
  const first = {
    key: "101:sentence-1",
    speakerUid: "101",
    speakerName: "Zico",
    text: "Hello",
    startMs: 1_000,
    status: "partial" as const
  } satisfies PartialTranscriptSegment;
  const finalizing = { ...first, text: "Hello there.", status: "finalizing" as const };
  const nextSentence = { ...first, key: "101:sentence-2", text: "What is next?", startMs: 2_000 };

  let buffer = upsertLiveTranscript({}, first);
  buffer = upsertLiveTranscript(buffer, finalizing);
  buffer = upsertLiveTranscript(buffer, nextSentence);
  buffer = upsertLiveTranscript(buffer, { ...first, text: "stale partial" });
  expect(Object.values(buffer).map((segment) => [segment.key, segment.status, segment.text])).toEqual([
    ["101:sentence-1", "finalizing", "Hello there."],
    ["101:sentence-2", "partial", "What is next?"]
  ]);
  expect(removeLiveTranscript(buffer, first.key)).toEqual({ [nextSentence.key]: nextSentence });
});

test("Agora STT owns human text but never retranscribes Copilot audio", () => {
  expect(shouldUseAgoraSttSegment("101")).toBe(true);
  expect(shouldUseAgoraSttSegment("900001")).toBe(false);
});

test("expected cross-participant voice turn rejections stay silent", () => {
  expect(shouldSilenceCopilotTurnSubmissionError(new Error("A participant can submit only their own voice turn"))).toBe(true);
  expect(shouldSilenceCopilotTurnSubmissionError(new Error("Copilot is unavailable"))).toBe(false);
  expect(shouldSilenceCopilotTurnSubmissionError("A participant can submit only their own voice turn")).toBe(false);
});

test("Agora STT starts lazily only after captions are enabled", () => {
  const connected = { connectionState: "connected", hasRtcClient: true, alreadyStarted: false };
  expect(shouldStartMeetingTranscription({ ...connected, captionsOn: false })).toBe(false);
  expect(shouldStartMeetingTranscription({ ...connected, captionsOn: true })).toBe(true);
  expect(shouldStartMeetingTranscription({ ...connected, captionsOn: true, transcriptionStatus: "active" })).toBe(false);
  expect(shouldStartMeetingTranscription({ ...connected, captionsOn: true, alreadyStarted: true })).toBe(false);
  expect(shouldStartMeetingTranscription({ ...connected, captionsOn: true, connectionState: "failed" })).toBe(false);
});

test("late joiners resolve the existing host from the room snapshot", () => {
  const participants = [{
    roomId: "meet-devx",
    rtcUid: "205309",
    displayName: "Zico",
    role: "host" as const,
    joinedAt: "2026-07-11T00:00:00.000Z",
    lastSeenAt: "2026-07-11T00:00:00.000Z"
  }];

  expect(resolveParticipantProfile("205309", {}, participants)).toEqual({ displayName: "Zico", role: "host" });
  expect(resolveParticipantProfile("205309", { "205309": "Zhichao" }, participants)).toEqual({ displayName: "Zhichao", role: "host" });
  expect(resolveParticipantProfile("999999", {}, participants)).toEqual({ displayName: "Joining...", role: "guest" });
  expect(resolveTranscriptSpeakerName("900001", {})).toBe("Copilot");
  expect(resolveTranscriptSpeakerName("205309", { "205309": "Zico" })).toBe("Zico");
  expect(resolveTranscriptSpeakerName("205309", {})).toBe("Participant");
});

test("room codes keep one immutable meet prefix", () => {
  expect(normalizeRoomCodeSuffix("devx")).toBe("devx");
  expect(normalizeRoomCodeSuffix("meet-devx")).toBe("devx");
  expect(normalizeRoomCodeSuffix("meet-meet-devx")).toBe("devx");
  expect(buildRoomCode("meet-meet-devx")).toBe("meet-devx");
  expect(isValidRoomCode(buildRoomCode("devx"))).toBe(true);
  expect(isValidRoomCode(buildRoomCode("-devx"))).toBe(false);
  expect(meetingPath("MEET-DevX")).toBe("/?room=meet-devx");
  expect(meetingSummaryPath("MEET-DevX")).toBe("/summary?room=meet-devx");
  expect(meetingBoardPath("MEET-DevX")).toBe("/board?room=meet-devx");
});

test("canceling the screen picker stays silent while real capture failures remain actionable", () => {
  expect(isScreenShareCancellation({
    code: "PERMISSION_DENIED",
    name: "AgoraRTCError",
    message: "NotAllowedError: Permission denied by user"
  })).toBe(true);
  expect(isScreenShareCancellation({ name: "AbortError", message: "The operation was aborted" })).toBe(true);

  const captureFailure = { name: "NotReadableError", message: "Could not start video source" };
  expect(isScreenShareCancellation(captureFailure)).toBe(false);
  expect(screenShareErrorMessage(captureFailure)).toBe("Your screen could not be captured. Check system screen recording permissions and try again.");
});

test("direct Copilot turns join the meeting transcript and replace duplicate STT captures", () => {
  const roomCreatedAt = "2026-07-11T00:00:00.000Z";
  const commonSegment = { roomId: "meet-devx", transcriptionSessionId: "stt-devx", sequence: 1, identityQuality: "source" as const, language: "en-US", durationMs: 700 };
  const entries = buildUnifiedTranscriptEntries([
    { ...commonSegment, id: "human", sourceSentenceId: "human-1", speakerUid: "101", speakerName: "Zico", text: "What is next?", startMs: 1_000, createdAt: "2026-07-11T00:00:01.700Z" },
    { ...commonSegment, id: "ai-stt", sourceSentenceId: "ai-1", speakerUid: "900001", speakerName: "Copilot", text: "Imprecise STT copy.", startMs: 2_000, createdAt: "2026-07-11T00:00:02.700Z" }
  ], [{ id: "ai-direct", roomId: "meet-devx", agentTurnId: 2, turnSequence: 1, speakerUid: "900001", speakerName: "Copilot", role: "assistant", text: "Ship the demo next.", status: "final", createdAt: "2026-07-11T00:00:03.000Z" }], roomCreatedAt);

  expect(entries.map((entry) => entry.text)).toEqual(["What is next?", "Ship the demo next."]);
  expect(entries.at(-1)).toMatchObject({ source: "copilot", speakerName: "Copilot", startMs: 3_000 });
  expect(visibleTranscriptEntries(entries, false).map((entry) => entry.text)).toEqual(["Ship the demo next."]);
  expect(visibleTranscriptEntries(entries, true)).toEqual(entries);
});

test("local transcript clearing hides existing entries but keeps later entries", () => {
  const entries = [
    { id: "human-1", source: "meeting" as const, speakerUid: "101", speakerName: "Zico", text: "First point.", startMs: 1_000, createdAt: "2026-09-09T00:00:01.000Z" },
    { id: "copilot-1", source: "copilot" as const, speakerUid: "900001", speakerName: "Copilot", text: "First response.", startMs: 2_000, createdAt: "2026-09-09T00:00:02.000Z" }
  ];
  const clearedEntryKeys = new Set(entries.map(transcriptEntryKey));
  const laterEntry = { id: "copilot-2", source: "copilot" as const, speakerUid: "900001", speakerName: "Copilot", text: "Later response.", startMs: 3_000, createdAt: "2026-09-09T00:00:03.000Z" };

  expect(withoutLocallyClearedTranscriptEntries(entries, clearedEntryKeys)).toEqual([]);
  expect(withoutLocallyClearedTranscriptEntries([...entries, laterEntry], clearedEntryKeys)).toEqual([laterEntry]);
});

test("cumulative GPT Live assistant transcripts collapse into one completed turn", () => {
  const roomCreatedAt = "2026-08-24T00:00:00.000Z";
  const repeated = "It sounds It sounds like you It sounds like you started to It sounds like you started to ask something. It sounds like you started to ask something. Could It sounds like you started to ask something. Could you repeat It sounds like you started to ask something. Could you repeat that? It sounds like you started to ask something. Could you repeat that?";
  const turns = [{
    id: "assistant-final",
    roomId: "meet-live",
    agentTurnId: 17,
    turnSequence: 4,
    speakerUid: "900001",
    speakerName: "Copilot",
    role: "assistant" as const,
    text: repeated,
    status: "final" as const,
    createdAt: "2026-08-24T00:00:01.000Z"
  }];

  const entries = buildUnifiedTranscriptEntries([], turns, roomCreatedAt);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    source: "copilot",
    text: "It sounds like you started to ask something. Could you repeat that?",
    startMs: 1_000
  });
  expect(normalizeCumulativeTranscript("Hi there Hi there! Hi there! What's on Hi there! What's on your mind Hi there! What's on your mind?")).toBe("Hi there! What's on your mind?");
  expect(normalizeCumulativeTranscript("Call me ChatGPT Call me ChatGPT.")).toBe("Call me ChatGPT.");
  expect(normalizeCumulativeTranscript("I’m Copilot. I’m Copilot.")).toBe("I’m Copilot.");
  // Snapshot normalization must work when the provider omits word spacing.
  expect(normalizeCumulativeTranscript("HelloHello, I am your meeting assistant.")).toBe("Hello, I am your meeting assistant.");
  expect(normalizeCumulativeTranscript("HelloHello, I am your assistant.")).toBe("Hello, I am your assistant.");
  // Two snapshots can be as short as a greeting, so there is no minimum length to lean on.
  expect(normalizeCumulativeTranscript("Hey, Hey, what's up")).toBe("Hey, what's up");
  // The provider may repeat an unchanged snapshot before delivering a longer one.
  expect(normalizeCumulativeTranscript("It sounds It sounds like you It sounds like you started to It sounds like you started to ask something. It sounds like you started to ask something. Could It sounds like you started to ask something. Could you repeat It sounds like you started to ask something. Could you repeat that?")).toBe("It sounds like you started to ask something. Could you repeat that?");
  expect(normalizeCumulativeTranscript("go go go go go go home")).toBe("go go go go go go home");
  expect(normalizeCumulativeTranscript("Let's ship the demo on Friday.")).toBe("Let's ship the demo on Friday.");
  expect(normalizeCumulativeTranscript("We will ship the demo on Friday.")).toBe("We will ship the demo on Friday.");
  const longFinal = "First, align on the goal and success metrics, so everyone's clear on what winning looks like. Second, lock down messaging and target audience so that sales and marketing speak with one voice. And third, confirm readiness and owners across functions, like launch timeline, channels, support coverage, and escalation paths.";
  const longWords = longFinal.split(" ");
  const longCumulative = `${longWords.map((_, index) => longWords.slice(0, index + 1).join(" ")).join(" ")} ${longFinal}`;
  expect(longCumulative.length).toBeGreaterThan(4_000);
  expect(normalizeCumulativeTranscript(longCumulative)).toBe(longFinal);

  expect(parseCopilotTurn({
    object: "user.transcription",
    final: true,
    user_id: "101",
    turn_id: 18,
    stream_id: 5,
    text: "Hello hello, I am Zico."
  }, { "101": "Zico" })).toMatchObject({
    role: "user",
    text: "Hello hello, I am Zico."
  });

  expect(parseCopilotTurn({
    object: "assistant.transcription",
    turn_id: 17,
    stream_id: 4,
    turn_seq_id: 5,
    turn_status: 1,
    text: repeated
  }, {})).toMatchObject({ agentTurnId: 17, turnSequence: 4, role: "assistant", text: "It sounds like you started to ask something. Could you repeat that?", status: "final" });

  expect(parseToolkitCopilotTurn({
    uid: "900001",
    stream_id: 4,
    turn_id: 17,
    _time: Date.parse("2026-08-24T00:00:01.000Z"),
    text: repeated,
    status: TurnStatus.END,
    metadata: { object: MessageType.AGENT_TRANSCRIPTION, language: "en-US" }
  })).toMatchObject({ agentTurnId: 17, turnSequence: 4, text: "It sounds like you started to ask something. Could you repeat that?", status: "final" });
});

test("pending live notes keep the latest completed document visible", () => {
  const document = { title: "Existing notes", overview: "The previous version of the notes.", topics: [], decisions: [], actionItems: [], openQuestions: [], keyPoints: [], sourceQuality: "good" as const };
  const current = { id: "live-1", roomId: "meet-devx", kind: "live" as const, version: 1, status: "completed" as const, sourceThroughSequence: 8, document, createdAt: "2026-07-12T03:00:00.000Z", updatedAt: "2026-07-12T03:01:00.000Z" };
  const pending = { id: "live-2", roomId: "meet-devx", kind: "live" as const, version: 2, status: "pending" as const, sourceThroughSequence: 16, createdAt: "2026-07-12T03:15:00.000Z", updatedAt: "2026-07-12T03:15:00.000Z" };

  expect(mergeVisibleMeetingNotes(current, pending)).toMatchObject({
    id: "live-2",
    status: "pending",
    document,
    updatedAt: current.updatedAt
  });
});

test("meeting launcher remains usable at every target viewport", async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Bring an AI teammate that can ask, answer, summarize, and act in every meeting.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start meeting" })).toBeVisible();
    const agoraLogo = page.getByTestId("agora-logo");
    await expect(agoraLogo).toBeVisible();
    const logoContainerStyle = await agoraLogo.evaluate((element) => {
      const style = window.getComputedStyle(element.parentElement!);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(logoContainerStyle).toEqual({
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderWidth: "0px",
      boxShadow: "none",
    });
    const roomCode = page.getByLabel("Room code");
    await expect(roomCode).toBeVisible();
    await expect(roomCode).toHaveValue("");
    if (viewport.name !== "mobile-landscape") {
      await expect(page.getByText("AI joins your meeting as a teammate.", { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Join room" })).toBeDisabled();
    await assertNoDocumentOverflow(page, viewport.name);
  }
});

test("webcam pixel grid renders and reduced motion keeps the hero stable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator(".home-webcam-layer")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => page.locator(".home-webcam-layer canvas:not([class*='h-0'])").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) visible += 1;
    }
    return visible;
  })).toBeGreaterThan(100);
  const displayCanvas = page.locator(".home-webcam-layer canvas:not([class*='h-0'])");
  const firstFrame = await displayCanvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    return Array.from(pixels).filter((_, index) => index % 40 === 0);
  });
  await page.waitForTimeout(700);
  const changedSamples = await displayCanvas.evaluate((element, previousFrame) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    let changed = 0;
    for (let index = 0, sample = 0; index < pixels.length; index += 40, sample += 1) {
      if (Math.abs(pixels[index] - previousFrame[sample]) > 2) changed += 1;
    }
    return changed;
  }, firstFrame);
  expect(changedSamples).toBeGreaterThan(100);
  await page.waitForTimeout(1900);
  await expect(page.getByRole("heading", { name: "Bring an AI teammate that can ask, answer, summarize, and act in every meeting." })).toBeVisible();
  await expect(page.getByTestId("rotating-verb").locator('[data-word="act"]')).toHaveCSS("opacity", "1");
});

test("hero cycles through the AI teammate capabilities", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Real-time collaboration powered by Agora and GPT‑Live‑1 API.", { exact: true })).toBeVisible();
  await expect(page.getByText("Powered by GPT‑Live‑1 API", { exact: true })).toBeVisible();
  const verb = page.getByTestId("rotating-verb");
  const activeWord = () => verb.evaluate((element) => {
    const words = Array.from(element.querySelectorAll<HTMLElement>("[data-word]"));
    return words.sort((left, right) => Number(getComputedStyle(right).opacity) - Number(getComputedStyle(left).opacity))[0]?.dataset.word;
  });
  const firstWord = await activeWord();
  await expect.poll(activeWord, { timeout: 3_500 }).not.toBe(firstWord);
});

test("ripple grid remains visible when camera access fails", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Camera permission denied", "NotAllowedError");
    };
  });
  await page.goto("/");

  await expect(page.locator(".home-webcam-layer")).toHaveAttribute("data-ready", "false");
  await expect(page.locator(".home-ripple-layer .cell").first()).toBeVisible();
  await expect(page.locator(".home-ripple-layer .cell")).toHaveCount(486);
  await page.locator(".home-ripple-layer .cell").nth(180).click();
  await expect(page.locator(".home-ripple-layer .animate-cell-ripple")).toHaveCount(486);
});

test("launcher keeps the prefix fixed and validates only the suffix", async ({ page }) => {
  await page.goto("/");
  const roomCode = page.getByLabel("Room code");

  await roomCode.fill("meet-meet-devx");
  await expect(roomCode).toHaveValue("devx");
  await expect(page.getByRole("button", { name: "Join room" })).toBeEnabled();

  await roomCode.fill("bad code");

  await expect(page.getByText("Use 3–32 letters, numbers, or hyphens.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join room" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Join the meeting" })).not.toBeVisible();
});

test("prejoin has live media controls and a stable 16:9 preview", async ({ page }) => {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    (window as Window & { mediaPreviewRequests?: number }).mediaPreviewRequests = 0;
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: (constraints: MediaStreamConstraints) => {
        const trackedWindow = window as Window & { mediaPreviewRequests?: number };
        trackedWindow.mediaPreviewRequests = (trackedWindow.mediaPreviewRequests ?? 0) + 1;
        return original(constraints);
      }
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.request.post("http://127.0.0.1:8787/rooms");
  await page.goto("/?room=meet-playwright");

  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Join the meeting" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Join meeting" })).toBeDisabled();
  await expect(page.getByLabel("Your camera preview")).toHaveCount(0);
  await expect(page.getByText("Camera is off", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn microphone on" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Turn camera on" })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => (window as Window & { mediaPreviewRequests?: number }).mediaPreviewRequests)).toBe(0);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("button", { name: "Turn microphone on" })).toHaveCSS("background-color", "rgb(239, 91, 91)");
  await expect(page.getByRole("button", { name: "Turn camera on" })).toHaveCSS("background-color", "rgb(239, 91, 91)");
  await page.getByRole("button", { name: "Turn microphone on" }).click();
  await page.getByRole("button", { name: "Turn camera on" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { mediaPreviewRequests?: number }).mediaPreviewRequests)).toBeGreaterThan(0);
  await expect(page.getByLabel("Your camera preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn microphone off" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Turn camera off" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("prejoin-grid")).toHaveCSS("background-size", "48px 48px, 48px 48px");

  const header = page.locator("header");
  const back = page.getByRole("button", { name: "Back to home" });
  const centeredBrand = header.getByTestId("brand");
  const [headerBounds, backBounds, brandBounds, mainBounds, stageBounds] = await Promise.all([
    header.boundingBox(),
    back.boundingBox(),
    centeredBrand.boundingBox(),
    page.locator("main").boundingBox(),
    page.getByTestId("prejoin-stage").boundingBox()
  ]);
  expect(backBounds?.x).toBeLessThan(50);
  expect(Math.abs((brandBounds!.x + brandBounds!.width / 2) - (headerBounds!.x + headerBounds!.width / 2))).toBeLessThan(2);
  expect(Math.abs((stageBounds!.y + stageBounds!.height / 2) - (mainBounds!.y + mainBounds!.height / 2))).toBeLessThan(25);

  const ratio = await page.locator(".preview-frame").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width / bounds.height;
  });
  expect(ratio).toBeGreaterThan(1.76);
  expect(ratio).toBeLessThan(1.79);
  await assertNoDocumentOverflow(page, "prejoin desktop");
});

test("meeting links survive refresh and browser navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start meeting" }).click();
  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Join the meeting" })).toBeVisible();

  await page.route("**/rooms/meet-playwright/artifacts/status", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.reload();
  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Join the meeting" })).toBeVisible();

  await page.getByLabel("Your name").fill("Zico");
  await page.getByRole("button", { name: "Join meeting" }).click();
  await expect(page.getByRole("toolbar", { name: "Meeting controls" })).toBeVisible();
  await page.getByRole("toolbar", { name: "Meeting controls" }).getByRole("button", { name: "Leave" }).click();
  await expect(page.getByRole("dialog", { name: "Leave this meeting?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Leave this meeting?" }).getByRole("button", { name: "Leave meeting" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Bring an AI teammate that can ask, answer, summarize, and act in every meeting." })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Join the meeting" })).toBeVisible();
});

test("active meetings guard browser exit and explicit leave disarms the guard", async ({ page }) => {
  await enterMeetingWithMediaOff(page);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);

  await page.getByRole("toolbar", { name: "Meeting controls" }).getByRole("button", { name: "Leave" }).click();
  await page.getByRole("dialog", { name: "Leave this meeting?" }).getByRole("button", { name: "Leave meeting" }).click();
  await expect(page).toHaveURL("/");
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test("prejoin remains reachable on portrait and short landscape screens", async ({ page }) => {
  for (const viewport of viewports.filter((item) => item.name === "mobile" || item.name === "mobile-landscape")) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Start meeting" }).click();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Join meeting" })).toBeVisible();
    await assertNoDocumentOverflow(page, `${viewport.name} prejoin`);
  }
});

test("user can manage the AI member, use the inline board, and open the full board separately", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterMeetingWithMediaOff(page);

  const toolbar = page.getByRole("toolbar", { name: "Meeting controls" });
  await expect(toolbar).toBeVisible();
  const inviteCopilot = toolbar.getByRole("button", { name: "Invite Copilot" });
  await expect(inviteCopilot).toBeVisible();
  await expect(inviteCopilot.locator(".lucide-bot")).toBeVisible();
  await expect(inviteCopilot).toHaveClass(/border-agora/);
  await expect(toolbar.getByRole("button", { name: "Notes" })).toHaveClass(/border-line/);
  const transcriptPanel = page.getByRole("complementary", { name: "Transcript panel" });
  await expect(transcriptPanel).toBeVisible();
  await expect.poll(async () => (await transcriptPanel.boundingBox())?.width).toBe(480);
  await expect(page.getByTestId("copilot-status")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "React" }).click();
  await page.getByRole("menuitem", { name: "React 👍" }).click();
  await expect(page.getByLabel("Meeting reactions")).toContainText("Zico");
  await page.getByRole("button", { name: "Invite Copilot" }).click();
  const consent = page.getByRole("dialog", { name: "Invite Copilot?" });
  await expect(consent).toBeVisible();
  await expect(consent.getByText("Anyone can say “Copilot”")).toBeVisible();
  await consent.getByRole("button", { name: "Invite Copilot" }).click();
  await expect(page.getByTestId("copilot-status")).toHaveText("Listening");
  await expect(page.getByTestId("copilot-engine-label")).toHaveText("Powered by GPT‑Live‑1 API");
  await expect(page.getByTestId("copilot-engine-label")).toHaveCSS("font-size", "11px");
  const copilotControls = page.getByRole("button", { name: "Copilot controls" });
  await expect(copilotControls).toBeVisible();
  await expect(copilotControls.locator(".lucide-ellipsis-vertical")).toBeVisible();
  await copilotControls.click();
  const copilotMenu = page.getByRole("menu", { name: "Copilot controls" });
  await expect(copilotMenu.getByRole("menuitem", { name: "Stop speaking" })).toBeVisible();
  await expect(copilotMenu.getByRole("menuitem", { name: "Remove from meeting" })).toBeVisible();
  const interruptRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/rooms/meet-playwright/agent/interrupt"));
  await copilotMenu.getByRole("menuitem", { name: "Stop speaking" }).click();
  await interruptRequest;
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Copilot stopped speaking" })).toBeVisible();
  await expect(page.getByTestId("copilot-status")).toHaveText("Listening");
  await expect(page.getByRole("complementary", { name: "Copilot panel" })).toHaveCount(0);

  await expect(transcriptPanel.getByRole("tab")).toHaveCount(5);
  await expect(transcriptPanel.getByRole("tab", { name: "Copilot" })).toHaveCount(0);
  for (const tabName of ["Transcript", "Notes", "Board", "Chat", "People"]) {
    await expect(transcriptPanel.getByRole("tab", { name: tabName })).toContainText(tabName);
  }
  const captionsSwitch = transcriptPanel.getByRole("switch", { name: "Captions off" });
  await expect(captionsSwitch).not.toBeChecked();
  await expect(transcriptPanel).toContainText("Transcription off");
  const transcriptEndpoint = "http://127.0.0.1:8787/rooms/meet-playwright/transcript-segments";
  const copilotTurnEndpoint = "http://127.0.0.1:8787/rooms/meet-playwright/copilot/turns";
  await page.request.post(transcriptEndpoint, { data: { transcriptionSessionId: "stt-playwright", sourceSentenceId: "same-speaker-1", speakerUid: "100001", text: "First point.", startMs: 1000, durationMs: 500 } });
  await page.request.post(transcriptEndpoint, { data: { transcriptionSessionId: "stt-playwright", sourceSentenceId: "same-speaker-2", speakerUid: "100001", text: "Second point.", startMs: 2000, durationMs: 500 } });
  await page.request.post(transcriptEndpoint, { data: { transcriptionSessionId: "stt-playwright", sourceSentenceId: "copilot-stt-copy", speakerUid: "900001", text: "Imprecise STT copy.", startMs: 2500, durationMs: 500 } });
  await page.request.post(copilotTurnEndpoint, { data: { agentTurnId: 11, turnSequence: 1, speakerUid: "900001", speakerName: "Copilot", role: "assistant", text: "Validate the launch plan next.", status: "final" } });
  await expect(transcriptPanel.getByText("Zico", { exact: true })).toHaveCount(0);
  await expect(transcriptPanel.getByText("Copilot", { exact: true })).toHaveCount(1);
  await expect(transcriptPanel.getByText("Validate the launch plan next.", { exact: true })).toBeVisible();
  await expect(transcriptPanel.getByText("Imprecise STT copy.", { exact: true })).toHaveCount(0);
  await expect(transcriptPanel.getByText("Continued", { exact: true })).toHaveCount(0);
  await captionsSwitch.click();
  await expect(transcriptPanel.getByRole("switch", { name: "Captions on" })).toBeChecked();
  await expect(transcriptPanel.getByText("Zico", { exact: true })).toHaveCount(2);
  await transcriptPanel.getByRole("tab", { name: "Board" }).click();
  const boardPanel = page.getByRole("complementary", { name: "Board panel" });
  await expect(boardPanel).toBeVisible();
  await expect(boardPanel.getByText("Voice-synced board")).toBeVisible();
  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
  const boardPopupPromise = page.waitForEvent("popup");
  await boardPanel.getByRole("link", { name: "Open full board" }).click();
  const boardPopup = await boardPopupPromise;
  await expect(boardPopup).toHaveURL(/\/board\?room=meet-playwright/);
  await boardPopup.close();
  await boardPanel.getByRole("tab", { name: "Notes" }).click();
  await expect(page.getByRole("complementary", { name: "Notes panel" })).toBeVisible();
  await page.getByRole("complementary", { name: "Notes panel" }).getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByRole("complementary", { name: "Chat panel" })).toContainText("Start the conversation");
  await page.getByRole("complementary", { name: "Chat panel" }).getByRole("tab", { name: "People" }).click();
  const peoplePanel = page.getByRole("complementary", { name: "People panel" });
  await expect(peoplePanel).toBeVisible();
  await expect(peoplePanel.locator(".people-list").getByText("Copilot", { exact: true })).toBeVisible();
  await expect(peoplePanel.getByText("Teammate", { exact: true })).toBeVisible();
  await peoplePanel.getByLabel("Search people").fill("Zico");
  await expect(peoplePanel.locator(".people-list").getByText("Copilot", { exact: true })).toHaveCount(0);
  await peoplePanel.getByLabel("Search people").fill("");
  await page.getByLabel("Close People panel").click();
  await copilotControls.click();
  await page.getByRole("menuitem", { name: "Remove from meeting" }).click();
  const removeDialog = page.getByRole("dialog", { name: "Remove Copilot?" });
  await expect(removeDialog).toContainText("The meeting, transcript, notes, and other participants will continue.");
  await removeDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(copilotControls).toBeVisible();
  await copilotControls.click();
  await page.getByRole("menuitem", { name: "Remove from meeting" }).click();
  await page.getByRole("dialog", { name: "Remove Copilot?" }).getByRole("button", { name: "Remove Copilot" }).click();
  await expect(page.getByRole("button", { name: "Invite Copilot" })).toBeVisible();
  for (const retiredControl of ["Ask Copilot", "Explain", "Recap", "Actions", "Speak", "Dismiss"]) {
    await expect(page.getByRole("button", { name: retiredControl, exact: true })).toHaveCount(0);
  }
  await assertNoDocumentOverflow(page, "meeting desktop");
});

test("clearing the transcript affects only the current browser view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterMeetingWithMediaOff(page);

  const panel = page.getByRole("complementary", { name: "Transcript panel" });
  const captionsSwitch = panel.getByRole("switch", { name: "Captions off" });
  await captionsSwitch.click();
  await expect(panel.getByRole("switch", { name: "Captions on" })).toBeChecked();

  await page.request.post("http://127.0.0.1:8787/rooms/meet-playwright/transcript-segments", {
    data: { transcriptionSessionId: "stt-playwright", sourceSentenceId: "clear-human-1", speakerUid: "100001", text: "Keep this on the server.", startMs: 1000, durationMs: 500 }
  });
  await page.request.post("http://127.0.0.1:8787/rooms/meet-playwright/copilot/turns", {
    data: { agentTurnId: 31, turnSequence: 1, speakerUid: "900001", speakerName: "Copilot", role: "assistant", text: "Clear this locally.", status: "final" }
  });
  await expect(panel.getByText("Keep this on the server.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Clear this locally.", { exact: true })).toBeVisible();

  const transcriptDeleteRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE" && /transcript/i.test(request.url())) transcriptDeleteRequests.push(request.url());
  });
  const clearButton = panel.getByRole("button", { name: "Clear", exact: true });
  await expect(clearButton).toBeEnabled();
  await clearButton.click();
  await expect(panel.getByText("Keep this on the server.", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Clear this locally.", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("switch", { name: "Captions on" })).toBeChecked();
  await expect(clearButton).toBeDisabled();
  expect(transcriptDeleteRequests).toEqual([]);

  await panel.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("complementary", { name: "Notes panel" }).getByRole("tab", { name: "Transcript" }).click();
  await expect(panel.getByText("Clear this locally.", { exact: true })).toHaveCount(0);

  await page.request.post("http://127.0.0.1:8787/rooms/meet-playwright/copilot/turns", {
    data: { agentTurnId: 32, turnSequence: 1, speakerUid: "900001", speakerName: "Copilot", role: "assistant", text: "This arrived after clearing.", status: "final" }
  });
  await expect(panel.getByText("This arrived after clearing.", { exact: true })).toBeVisible();
  await expect(clearButton).toBeEnabled();
  expect(transcriptDeleteRequests).toEqual([]);

  await page.reload();
  const restoredPanel = page.getByRole("complementary", { name: "Transcript panel" });
  await expect(restoredPanel.getByText("Clear this locally.", { exact: true })).toBeVisible();
  await expect(restoredPanel.getByText("This arrived after clearing.", { exact: true })).toBeVisible();
});

test("meeting operation feedback uses compact Sonner notifications", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedMeetingLink?: string }).copiedMeetingLink = value; } }
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterMeetingWithMediaOff(page);

  await page.getByRole("button", { name: "Invite people" }).click();
  const inviteDialog = page.getByRole("dialog", { name: "Invite people" });
  await expect(inviteDialog.getByRole("textbox", { name: "Meeting link" })).toHaveValue("http://127.0.0.1:3101/?room=meet-playwright");
  await inviteDialog.getByRole("button", { name: "Copy meeting link" }).click();
  const successToast = page.locator("[data-sonner-toast]").filter({ hasText: "Meeting link copied" });
  await expect(successToast).toBeVisible();
  const successBounds = await successToast.boundingBox();
  expect(successBounds).not.toBeNull();
  if (successBounds) expect(successBounds.width).toBeLessThan(420);
  const viewport = page.viewportSize()!;
  if (successBounds) expect(Math.abs((successBounds.x + successBounds.width / 2) - viewport.width / 2)).toBeLessThan(4);
  await expect(successToast.getByRole("button")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { copiedMeetingLink?: string }).copiedMeetingLink)).toBe("http://127.0.0.1:3101/?room=meet-playwright");
  await inviteDialog.getByRole("button", { name: "Close" }).click();

  await page.route("**/rooms/*/agent/start", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: "Copilot is unavailable right now." }),
      contentType: "application/json",
      status: 503
    });
  });
  await page.getByRole("button", { name: "Invite Copilot" }).click();
  await page.getByRole("dialog", { name: "Invite Copilot?" }).getByRole("button", { name: "Invite Copilot" }).click();

  const errorToast = page.locator("[data-sonner-toast]").filter({ hasText: "Copilot is unavailable right now." });
  await expect(errorToast).toBeVisible();
  await expect(page.locator(".room-error")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertInsideViewport(page, errorToast, "mobile Sonner notification");
  await assertNoDocumentOverflow(page, "mobile Sonner notification");
});

test("people can manage the dedicated board while Copilot shares the same activity stream", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterMeetingWithMediaOff(page);
  const toolbar = page.getByRole("toolbar", { name: "Meeting controls" });
  await toolbar.getByRole("button", { name: "Board" }).click();
  const boardPanel = page.getByRole("complementary", { name: "Board panel" });
  await expect(boardPanel).toBeVisible();
  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
  const boardPopupPromise = page.waitForEvent("popup");
  await boardPanel.getByRole("link", { name: "Open full board" }).click();
  const boardPage = await boardPopupPromise;
  await boardPage.waitForLoadState("domcontentloaded");
  await expect(boardPage).toHaveURL(/\/board\?room=meet-playwright/);
  await expect(boardPage.getByRole("heading", { name: "Join the board" })).toBeVisible();
  await boardPage.getByLabel("Your name").fill("Zico");
  await boardPage.getByRole("button", { name: "Open board" }).click();
  await expect(boardPage.getByRole("heading", { name: "Meeting board" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Meeting controls" })).toBeVisible();

  await boardPage.getByRole("button", { name: "New card" }).click();
  const editor = boardPage.getByRole("dialog", { name: "Create card" });
  await editor.getByLabel("Title").fill("Publish customer launch brief");
  await editor.getByLabel("Description").fill("Include the final customer proof and owner review.");
  await editor.getByLabel("Priority").selectOption("high");
  await editor.getByLabel("Assignee").selectOption({ label: "Zico" });
  await editor.getByLabel("Due date").fill("2026-08-25");
  await editor.getByLabel("Tags").fill("launch, customer");
  await editor.getByRole("button", { name: "Create card" }).click();
  await boardPage.reload();

  const card = boardPage.getByRole("article").filter({ hasText: "Publish customer launch brief" });
  await expect(card).toContainText("high");
  await expect(card).toContainText("Zico");
  await expect(card).toContainText("Aug 25");
  const activity = boardPage.getByRole("complementary", { name: "Board activity" });
  await expect(activity).toContainText("Zico manually");
  await expect(activity).toContainText("Publish customer launch brief");

  await card.getByRole("button").click();
  const edit = boardPage.getByRole("dialog", { name: "Edit card" });
  await edit.getByLabel("Status").selectOption("in_progress");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await boardPage.reload();
  const inProgressCard = boardPage.getByRole("region", { name: "In progress" }).getByRole("article").filter({ hasText: "Publish customer launch brief" });
  await expect(inProgressCard).toBeVisible();
  await inProgressCard.dragTo(boardPage.getByRole("region", { name: "Blocked" }));
  await expect(boardPage.getByRole("region", { name: "Blocked" })).toContainText("Publish customer launch brief");

  await boardPage.reload();
  await expect(boardPage.getByRole("region", { name: "Blocked" }).getByRole("article").filter({ hasText: "Publish customer launch brief" })).toBeVisible();
  await expect(boardPage.getByRole("link", { name: "Back to meeting" })).toHaveAttribute("href", "/?room=meet-playwright");
  await assertNoDocumentOverflow(boardPage, "dedicated board desktop");
  await boardPage.setViewportSize({ width: 390, height: 844 });
  await expect(boardPage.getByRole("button", { name: "Activity" })).toBeVisible();
  await expect(boardPage.getByRole("button", { name: "New card" })).toBeVisible();
  await assertNoDocumentOverflow(boardPage, "dedicated board mobile");
  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
  await boardPage.close();
});

test("meeting room and information sheet fit portrait and landscape mobile", async ({ page }) => {
  for (const viewport of viewports.filter((item) => item.name.startsWith("mobile"))) {
    await page.setViewportSize(viewport);
    await enterMeetingWithMediaOff(page);

    const toolbar = page.getByRole("toolbar", { name: "Meeting controls" });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "More" })).toBeVisible();
    await assertInsideViewport(page, toolbar, `${viewport.name} toolbar`);

    await toolbar.getByRole("button", { name: "React" }).click();
    const reactionPicker = page.getByRole("menu", { name: "Choose a reaction" });
    await expect(reactionPicker).toBeVisible();
    await assertInsideViewport(page, reactionPicker, `${viewport.name} reaction picker`);
    await reactionPicker.getByRole("menuitem", { name: "React 👍" }).click();

    await toolbar.getByRole("button", { name: "More" }).click();
    await toolbar.getByRole("button", { name: "Invite Copilot" }).click();
    const consent = page.getByRole("dialog", { name: "Invite Copilot?" });
    await expect(consent).toBeVisible();
    await consent.getByRole("button", { name: "Invite Copilot" }).click();
    await expect(page.getByTestId("copilot-status")).toHaveText("Listening");
    await toolbar.getByRole("button", { name: "More" }).click();
    await toolbar.getByRole("button", { name: "Transcript" }).click();
    const panel = page.getByRole("complementary", { name: "Transcript panel" });
    await expect(panel).toBeVisible();
    await assertInsideViewport(page, panel, `${viewport.name} Transcript panel`);
    await page.getByLabel("Close Transcript panel").click();
    await expect(toolbar.getByRole("button", { name: "Share screen" })).toBeHidden();
    await expect(toolbar.getByRole("button", { name: "People" })).toBeHidden();
    await expect(toolbar.locator(".toolbar-control:visible")).toHaveCount(5);
    await assertNoDocumentOverflow(page, `${viewport.name} meeting`);
    await toolbar.getByRole("button", { name: "Leave" }).click();
    await page.getByRole("dialog", { name: "Leave this meeting?" }).getByRole("button", { name: "Leave meeting" }).click();
    await expect(page).toHaveURL("/");
  }
});

test("host can end the room and download the meeting record", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterMeetingWithMediaOff(page);
  await page.getByRole("button", { name: "Invite Copilot" }).click();
  await page.getByRole("dialog", { name: "Invite Copilot?" }).getByRole("button", { name: "Invite Copilot" }).click();
  await expect(page.getByTestId("copilot-status")).toHaveText("Listening");
  await page.request.post("http://127.0.0.1:8787/rooms/meet-playwright/copilot/turns", { data: { agentTurnId: 21, turnSequence: 1, speakerUid: "900001", speakerName: "Copilot", role: "assistant", text: "Ship the validated launch plan.", status: "final" } });

  await page.getByRole("toolbar", { name: "Meeting controls" }).getByRole("button", { name: "Leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave this meeting?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "End for everyone" }).click();
  await expect(dialog.getByText("Finalizing transcript")).toBeVisible();

  await expect(page).toHaveURL(/\/summary\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Transcript and notes" })).toBeVisible();
  const endedHeader = page.getByRole("banner");
  const backToHome = endedHeader.getByRole("button", { name: "Back to home" });
  const endedBrand = endedHeader.getByText("Agora Meeting Copilot", { exact: true });
  await expect(backToHome).toBeVisible();
  await expect(endedBrand).toBeVisible();
  const backBounds = await backToHome.boundingBox();
  const brandBounds = await endedBrand.boundingBox();
  expect(backBounds).not.toBeNull();
  expect(brandBounds).not.toBeNull();
  if (backBounds && brandBounds) expect(backBounds.x + backBounds.width).toBeLessThan(brandBounds.x);
  const transcriptLink = page.getByRole("link", { name: "Download Transcript" });
  const notesLink = page.getByRole("link", { name: "Download Notes" });
  const downloadAllLink = page.getByRole("link", { name: "Download All" });
  await expect(transcriptLink).toHaveAttribute("href", /^\/api\/meeting-artifacts\/meet-[^/]+\/transcript\.md$/);
  await expect(notesLink).toHaveAttribute("href", /^\/api\/meeting-artifacts\/meet-[^/]+\/notes\.md$/);
  await expect(downloadAllLink).toHaveAttribute("href", /^\/api\/meeting-artifacts\/meet-[^/]+\/all\.zip$/);
  await expect(page.getByText("Launch planning meeting", { exact: true })).toBeVisible();
  await expect(page.getByText("The meeting confirmed the launch plan.")).toBeVisible();
  await expect(page.getByText("Launch planning", { exact: true })).toBeVisible();
  await expect(page.getByText("Launch plan confirmed.", { exact: true })).toBeVisible();
  await expect(page.getByText("Copilot", { exact: true })).toBeVisible();
  await expect(page.getByText("Ship the validated launch plan.", { exact: true })).toBeVisible();

  const downloadUrl = await downloadAllLink.getAttribute("href");
  const downloadResponse = await page.request.get(downloadUrl!);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()["content-type"]).toContain("application/zip");
  expect(downloadResponse.headers()["content-disposition"]).toContain("meeting-artifacts.zip");
  await page.reload();
  await expect(page).toHaveURL(/\/summary\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Transcript and notes" })).toBeVisible();
  await page.getByRole("button", { name: "Back to home" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/?room=meet-playwright");
  await expect(page).toHaveURL(/\/summary\?room=meet-playwright$/);
  await expect(page.getByRole("heading", { name: "Transcript and notes" })).toBeVisible();
  await assertNoDocumentOverflow(page, "meeting ended");
});

async function enterMeetingWithMediaOff(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start meeting" }).click();
  await expect(page.getByRole("button", { name: "Turn microphone on" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Turn camera on" })).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Your name").fill("Zico");
  await page.getByRole("button", { name: "Join meeting" }).click();
  await expect(page.getByRole("toolbar", { name: "Meeting controls" })).toBeVisible();
  await expect(page).toHaveURL(/\/?\?room=meet-playwright$/);
}

async function assertNoDocumentOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > window.innerWidth + 1,
    vertical: document.documentElement.scrollHeight > window.innerHeight + 1
  }));
  expect(overflow.horizontal, `${label} should not overflow horizontally`).toBe(false);
  expect(overflow.vertical, `${label} should not overflow vertically`).toBe(false);
}

async function assertInsideViewport(page: Page, locator: ReturnType<Page["locator"]>, label: string) {
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds, `${label} should have bounds`).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!bounds || !viewport) return;
  expect(bounds.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(bounds.y, `${label} top edge`).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
}
