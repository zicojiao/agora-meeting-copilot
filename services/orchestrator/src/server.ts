import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, store } = await buildApp(config);
const cleanup = setInterval(() => void store.deleteExpired(new Date().toISOString()), 10 * 60 * 1000);

const shutdown = async () => {
  clearInterval(cleanup);
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: config.PORT });
