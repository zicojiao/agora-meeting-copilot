import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Capability } from "./domain.js";

export function createSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function secretsMatch(value: string, expectedHash: string) {
  const actual = Buffer.from(hashSecret(value));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signCapability(payload: Capability, secret: string) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyCapability(token: string, secret: string): Capability {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new Error("Invalid capability");
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid capability signature");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Capability;
  if (!payload.roomId || !payload.rtcUid || !payload.role || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Capability expired or malformed");
  }
  return payload;
}

export function bearerToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) throw new Error("Missing bearer capability");
  return header.slice(7).trim();
}
