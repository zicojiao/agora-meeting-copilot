import { describe, expect, it } from "vitest";
import { decideConversationMode } from "../src/policy.js";
import { createSecret, hashSecret, secretsMatch, signCapability, verifyCapability } from "../src/security.js";

describe("room security", () => {
  it("signs room-scoped capabilities and rejects tampering", () => {
    const secret = createSecret();
    const token = signCapability({ roomId: "meet-a", rtcUid: "101", displayName: "Ada", role: "host", exp: Math.floor(Date.now() / 1000) + 60 }, secret);
    expect(verifyCapability(token, secret)).toMatchObject({ roomId: "meet-a", role: "host" });
    expect(() => verifyCapability(`${token}x`, secret)).toThrow(/signature/i);
  });

  it("stores host secrets as hashes", () => {
    const secret = createSecret();
    const hash = hashSecret(secret);
    expect(hash).not.toContain(secret);
    expect(secretsMatch(secret, hash)).toBe(true);
    expect(secretsMatch("wrong", hash)).toBe(false);
  });
});

describe("speaking policy", () => {
  it("requires a fresh direct wake phrase for every turn", () => {
    expect(decideConversationMode("Copilot, explain that", "standby")).toMatchObject({ nextMode: "focused", wake: true, extend: true });
    expect(decideConversationMode("Hey Copilot, explain that", "standby")).toMatchObject({ nextMode: "focused", wake: true, extend: true });
    expect(decideConversationMode("Um, Purvis, what should we do next?", "standby")).toMatchObject({ nextMode: "focused", wake: true, extend: true });
    expect(decideConversationMode("What about the deadline?", "focused")).toMatchObject({ nextMode: "standby", wake: false, extend: false });
    expect(decideConversationMode("The Copilot launch is next week", "standby")).toMatchObject({ nextMode: "standby", wake: false, extend: false });
    expect(decideConversationMode("Thanks Copilot", "focused")).toMatchObject({ nextMode: "standby", stop: true });
    expect(decideConversationMode("We should ship Friday", "standby")).toMatchObject({ nextMode: "standby", wake: false });
  });
});
