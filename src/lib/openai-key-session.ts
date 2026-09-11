const keyPrefix = "agora-meeting:openai-api-key:";

export function readOpenAiSessionKey(roomId: string) {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(`${keyPrefix}${roomId}`) ?? "";
}

export function saveOpenAiSessionKey(roomId: string, value: string) {
  window.sessionStorage.setItem(`${keyPrefix}${roomId}`, value.trim());
}

export function clearOpenAiSessionKey(roomId: string) {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(`${keyPrefix}${roomId}`);
}

export function isPlausibleOpenAiKey(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 20 && trimmed.length <= 512 && !/\s/.test(trimmed);
}
