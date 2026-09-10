export const roomCodePrefix = "meet-";
export const roomCodeExample = "2f4c8a6d10";

export function normalizeRoomCode(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeRoomCodeSuffix(value: string) {
  let suffix = normalizeRoomCode(value);
  while (suffix.startsWith(roomCodePrefix)) suffix = suffix.slice(roomCodePrefix.length);
  return suffix;
}

export function buildRoomCode(value: string) {
  const suffix = normalizeRoomCodeSuffix(value);
  return suffix ? `${roomCodePrefix}${suffix}` : "";
}

export function isValidRoomCode(value: string) {
  return /^meet-[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(normalizeRoomCode(value));
}
