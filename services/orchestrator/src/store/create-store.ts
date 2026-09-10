import type { Config } from "../config.js";
import { MemoryStore } from "./memory-store.js";
import { PostgresStore } from "./postgres-store.js";
import type { Store } from "./store.js";

export function createStore(config: Config): Store {
  if (config.STORAGE_DRIVER === "postgres") return new PostgresStore(config.DATABASE_URL!);
  return new MemoryStore();
}
