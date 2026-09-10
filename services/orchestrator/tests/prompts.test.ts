import { describe, expect, it } from "vitest";
import { meetingNotesPrompt } from "../src/runtime/meeting-notes-runtime.js";
import { buildGptLiveDelegation } from "../src/runtime/gpt-live-tools.js";
import { meetingInstructions } from "../src/runtime/prompts.js";

describe("meetingInstructions", () => {
  it("makes brevity and direct meeting speech explicit", () => {
    const instructions = meetingInstructions("focused");

    expect(instructions).toContain("an active teammate in this live meeting");
    expect(instructions).toContain("You have joined this meeting room");
    expect(instructions).toContain("Your colleagues may ask about things discussed in the meeting");
    expect(instructions).toContain("Use the current conversation and the supplied meeting context");
    expect(instructions).toContain("ANSWER FIRST");
    expect(instructions).toContain("DEFAULT TO ONE SHORT SPOKEN SENTENCE");
    expect(instructions).toContain("usually 5–20 words");
    expect(instructions).toContain("stay under 35 words total");
    expect(instructions).toContain("NEVER produce long explanations, essays, scripts, or meeting summaries");
    expect(instructions).toContain("then yield the floor");
    expect(instructions).toContain("shared Kanban board");
    expect(instructions).toContain("call the matching board function");
    expect(instructions).toContain("Wait for its result");
    expect(instructions).toContain("Never claim the board changed unless the function result says ok=true");
  });

  it("keeps the first release strictly English", () => {
    const instructions = meetingInstructions("standby");

    expect(instructions.startsWith("# Highest-Priority Output Language Contract")).toBe(true);
    expect(instructions).toContain("exactly one assistant output language: English");
    expect(instructions).toContain("Every spoken response and every assistant transcript MUST use English");
    expect(instructions).toContain("This rule overrides language detection");
    expect(instructions).toContain("do not guess a foreign language");
    expect(instructions).toContain('Say exactly: "Sorry, could you repeat that?"');
    expect(instructions).toContain('say exactly "I don\'t know from this meeting." in English');
    expect(instructions).toContain("# Final Check Before Every Response\nSpeak only English");
    expect(instructions).toContain("Never answer a direct question with only an acknowledgement or filler");
    expect(instructions).not.toContain("Match the language of the latest speaker");
    expect(instructions).not.toContain("in the speaker's language");
  });

  it("treats links as context instead of a reason to refuse", () => {
    const instructions = meetingInstructions("focused");

    expect(instructions).toContain("A URL is context, NEVER a reason to refuse");
    expect(instructions).toContain('refer to it only as "the link"');
    expect(instructions).toContain("silently omit the URL strings");
    expect(instructions).toContain('NEVER say "I can\'t", "I\'m unable", or "I shouldn\'t"');
    expect(instructions).toContain("NEVER narrate policies, limitations, verification, browsing, sources, URLs");
  });

  it("keeps standby silent and appends recent context", () => {
    const instructions = meetingInstructions("standby", "The team will ship Friday.");

    expect(instructions).toContain("DO NOT speak unless someone clearly says Copilot");
    expect(instructions).toContain("# Recent Meeting Context\nThe team will ship Friday.");
  });
});

describe("meetingNotesPrompt", () => {
  it("keeps live notes provisional", () => {
    const instructions = meetingNotesPrompt("live", false);

    expect(instructions).toContain("The meeting is still in progress");
    expect(instructions).not.toContain("The meeting has ended");
  });

  it("treats final notes as a completed meeting record", () => {
    const instructions = meetingNotesPrompt("final", false);

    expect(instructions).toContain("The meeting has ended");
    expect(instructions).toContain("never describe it as ongoing, live, or still in progress");
    expect(instructions).toContain("Write every human-readable note field in English");
    expect(instructions).toContain("Keep people's names, product names, company names, acronyms, technical identifiers");
    expect(instructions).toContain("Do not include a translation");
    expect(instructions).not.toContain("Use the language used most often in the meeting");
    expect(instructions).not.toContain("The meeting is still in progress");
  });
});

describe("GPT Live board delegation", () => {
  it("exposes only the non-destructive board functions", () => {
    const delegation = buildGptLiveDelegation("gpt-5.5");
    expect(delegation.type).toBe("responses");
    expect(delegation.responses.tools.map((tool) => tool.name)).toEqual([
      "create_board_card", "move_board_card", "update_board_card", "add_board_card_tags"
    ]);
    expect(delegation.responses.tools.map((tool) => tool.name)).not.toContain("delete_board_card");
    expect(delegation.responses.instructions).toContain("Never claim that the board changed until the function result reports ok=true");
  });
});
