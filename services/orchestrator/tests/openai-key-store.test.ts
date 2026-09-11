import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiKeyStore } from "../src/openai-key-store.js";

describe("OpenAiKeyStore", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps BYOK secrets in memory only until their TTL", () => {
    vi.useFakeTimers();
    const keys = new OpenAiKeyStore({ OPENAI_KEY_MODE: "byok", OPENAI_API_KEY: undefined, roomTtlMs: 1_000 });
    keys.set("meet-one", "sk-user-secret-long-enough");
    expect(keys.require("meet-one")).toBe("sk-user-secret-long-enough");
    vi.advanceTimersByTime(1_001);
    expect(() => keys.require("meet-one")).toThrow("required to invite");
  });

  it("uses an environment secret only in explicit server mode", () => {
    const keys = new OpenAiKeyStore({ OPENAI_KEY_MODE: "server", OPENAI_API_KEY: "sk-server-secret-long-enough", roomTtlMs: 1_000 });
    keys.set("meet-one", "sk-user-secret-long-enough");
    expect(keys.require("meet-one")).toBe("sk-server-secret-long-enough");
    keys.clear();
  });
});
