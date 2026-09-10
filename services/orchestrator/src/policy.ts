import type { ConversationMode } from "./domain.js";

const wakeName = "(?:copilot|co[- ]?pilot|live\\s+copilot|gpt[- ]?live|purvis)";
const wakePattern = new RegExp(`^\\s*(?:(?:hey|hi|okay|ok|so|um|uh)\\b[\\s,.-]*){0,2}${wakeName}\\b`, "i");
const stopPattern = /\b(?:thanks?|thank\s+you)\s+(?:copilot|co[- ]?pilot)\b|\b(?:stop|pause|stand\s*by|be\s+quiet)\s+(?:copilot|co[- ]?pilot)\b/i;

export type PolicyDecision = {
  nextMode: ConversationMode;
  wake: boolean;
  stop: boolean;
  extend: boolean;
};

export function decideConversationMode(text: string, _currentMode: ConversationMode): PolicyDecision {
  const stop = stopPattern.test(text);
  const wake = !stop && wakePattern.test(text);
  return {
    nextMode: wake ? "focused" : "standby",
    wake,
    stop,
    extend: wake
  };
}
