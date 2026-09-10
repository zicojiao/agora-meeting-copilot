import type { ConversationMode } from "./domain.js";

const wakePattern = /\b(?:hey\s+)?(?:copilot|co[- ]?pilot|live\s+copilot|gpt[- ]?live)\b/i;
const stopPattern = /\b(?:thanks?|thank\s+you)\s+(?:copilot|co[- ]?pilot)\b|\b(?:stop|pause|stand\s*by|be\s+quiet)\s+(?:copilot|co[- ]?pilot)\b/i;

export type PolicyDecision = {
  nextMode: ConversationMode;
  wake: boolean;
  stop: boolean;
  extend: boolean;
};

export function decideConversationMode(text: string, currentMode: ConversationMode): PolicyDecision {
  const stop = stopPattern.test(text);
  const wake = !stop && wakePattern.test(text);
  return {
    nextMode: stop ? "standby" : wake || currentMode === "focused" ? "focused" : "standby",
    wake,
    stop,
    extend: !stop && (wake || currentMode === "focused")
  };
}
