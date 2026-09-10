import { describe, expect, it } from "vitest";
import { normalizeCumulativeTranscript } from "../src/copilot-turns.js";

describe("normalizeCumulativeTranscript", () => {
  it("keeps the final GPT Live snapshot when an intermediate snapshot repeats", () => {
    const cumulative = "It sounds It sounds like you It sounds like you started to It sounds like you started to ask something. It sounds like you started to ask something. Could It sounds like you started to ask something. Could you repeat It sounds like you started to ask something. Could you repeat that?";

    expect(normalizeCumulativeTranscript(cumulative)).toBe("It sounds like you started to ask something. Could you repeat that?");
  });

  it("collapses an exact sentence replay from the assistant transcript", () => {
    expect(normalizeCumulativeTranscript("I’m Copilot. I’m Copilot.")).toBe("I’m Copilot.");
    expect(normalizeCumulativeTranscript("你好。你好。")).toBe("你好。");
  });
});
