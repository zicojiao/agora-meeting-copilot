export const COPILOT_NAME = "Copilot";

export function isCopilotDisplayName(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === COPILOT_NAME.toLowerCase() || normalized === "ai copilot";
}
