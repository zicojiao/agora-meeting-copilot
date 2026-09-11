import type { Config } from "./config.js";

type StoredKey = { value: string; expiresAt: number; timer: NodeJS.Timeout };

export class OpenAiKeyStore {
  private keys = new Map<string, StoredKey>();

  constructor(private config: Pick<Config, "OPENAI_KEY_MODE" | "OPENAI_API_KEY" | "roomTtlMs">) {}

  set(roomId: string, value: string) {
    if (this.config.OPENAI_KEY_MODE === "server") return;
    this.delete(roomId);
    const expiresAt = Date.now() + this.config.roomTtlMs;
    const timer = setTimeout(() => this.delete(roomId), this.config.roomTtlMs);
    timer.unref?.();
    this.keys.set(roomId, { value, expiresAt, timer });
  }

  require(roomId: string) {
    if (this.config.OPENAI_KEY_MODE === "server") {
      if (!this.config.OPENAI_API_KEY) throw new Error("The server OpenAI API key is not configured");
      return this.config.OPENAI_API_KEY;
    }
    const stored = this.keys.get(roomId);
    if (!stored || stored.expiresAt <= Date.now()) {
      this.delete(roomId);
      throw new Error("An OpenAI API key is required to invite the AI teammate");
    }
    return stored.value;
  }

  delete(roomId: string) {
    const stored = this.keys.get(roomId);
    if (stored) clearTimeout(stored.timer);
    this.keys.delete(roomId);
  }

  has(roomId: string) {
    try {
      this.require(roomId);
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    for (const roomId of this.keys.keys()) this.delete(roomId);
  }
}
