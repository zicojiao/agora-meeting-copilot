import { loadConfig } from "../src/config.js";
import { AgoraConvoAiRuntimeAdapter } from "../src/runtime/agora-convo-ai-runtime.js";

const config = loadConfig();
const runtime = new AgoraConvoAiRuntimeAdapter(config);
const roomId = `probe-${Date.now()}`;
const channel = process.env.AGORA_PROBE_CHANNEL?.trim() || roomId;
const holdMs = Math.max(0, Number(process.env.AGORA_PROBE_HOLD_MS || 5_000));

try {
  const result = await runtime.start({ roomId, channel, remoteUids: ["*"], initialContext: "Capability probe only." });
  console.log(JSON.stringify({ step: "start", ok: true, channel, result }));
  await runtime.say(roomId, "Agora meeting copilot GPT Live capability probe successful.");
  console.log(JSON.stringify({ step: "say", ok: true }));
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  console.log(JSON.stringify({ step: "status", ok: true, result: await runtime.getStatus(roomId) }));
} finally {
  await runtime.stop(roomId).catch(() => undefined);
  console.log(JSON.stringify({ step: "stop", ok: true }));
}
