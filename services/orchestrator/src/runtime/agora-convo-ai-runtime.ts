import { Agent, AgentSession, AgoraClient, Area, OpenAIGPTLive } from "agora-agents";
import type { Config } from "../config.js";
import type { ConversationMode } from "../domain.js";
import { createGptLiveProxyAccess, GPT_LIVE_MODEL } from "./gpt-live-gateway.js";
import { buildGptLiveResponses } from "./gpt-live-tools.js";
import { meetingInstructions } from "./prompts.js";
import type { RuntimeStatus, StartVoiceRuntimeInput, VoiceRuntimeAdapter } from "./voice-runtime.js";

type RuntimeEntry = { session: AgentSession; mode: ConversationMode };
const agentReadyTimeoutMs = 20_000;
const agentReadyPollMs = 250;

export class AgoraConvoAiRuntimeAdapter implements VoiceRuntimeAdapter {
  private sessions = new Map<string, RuntimeEntry>();
  private client: AgoraClient<typeof Area.US>;

  constructor(private config: Config, fetcher?: typeof fetch) {
    this.client = new AgoraClient({
      area: Area.US,
      appId: config.AGORA_APP_ID,
      appCertificate: config.AGORA_APP_CERTIFICATE,
      ...(fetcher ? { fetch: fetcher } : {})
    });
  }

  async start(input: StartVoiceRuntimeInput): Promise<RuntimeStatus> {
    const existing = this.sessions.get(input.roomId);
    if (existing?.session.status === "running") return { agentId: existing.session.id ?? undefined, status: "standby" };

    const mode: ConversationMode = "standby";
    const proxy = createGptLiveProxyAccess(this.config, input.roomId);
    const agent = new Agent({
      client: this.client,
      advancedFeatures: { enable_rtm: true, enable_tools: false },
      parameters: {
        audio_scenario: "chorus",
        data_channel: "rtm",
        enable_error_message: true,
        enable_metrics: true
      }
    }).withMllm(new OpenAIGPTLive({
      apiKey: proxy.apiKey,
      url: proxy.url,
      model: GPT_LIVE_MODEL,
      voice: "cedar",
      prompt: meetingInstructions(mode, input.initialContext),
      delegation: "responses",
      responsesModel: this.config.OPENAI_GPT_LIVE_DELEGATION_MODEL,
      // agora-agents 2.8.0 still carries an alpha selector as a provider
      // default. Explicitly omit it when using the generally available model.
      params: { alpha_selector: undefined, responses_params: buildGptLiveResponses() },
      ...(this.config.OPENAI_GPT_LIVE_GREETING ? { greeting: this.config.OPENAI_GPT_LIVE_GREETING } : {})
    }));

    const session = agent.createSession({
      name: `meeting-${input.roomId}-${Date.now()}`,
      channel: input.channel,
      agentUid: "900001",
      remoteUids: input.remoteUids.length ? input.remoteUids : ["*"],
      idleTimeout: 0,
      expiresIn: Math.min(this.config.ROOM_TTL_HOURS * 60 * 60, 86400),
      debug: false
    });
    this.sessions.set(input.roomId, { session, mode });
    try {
      const agentId = await session.start();
      await waitForAgentRunning(session);
      return { agentId, status: "standby" };
    } catch (error) {
      if (session.status === "running") await session.stop().catch(() => undefined);
      this.sessions.delete(input.roomId);
      throw normalizeRuntimeError(error);
    }
  }

  async stop(roomId: string, agentId?: string) {
    const entry = this.sessions.get(roomId);
    if (!entry) {
      if (agentId) await this.client.stopAgent(agentId);
      return;
    }
    try {
      await entry.session.stop();
    } finally {
      this.sessions.delete(roomId);
    }
  }

  async getStatus(roomId: string): Promise<RuntimeStatus> {
    const entry = this.sessions.get(roomId);
    if (!entry) return { status: "offline" };
    if (entry.session.status === "error") return { agentId: entry.session.id ?? undefined, status: "error" };
    if (entry.session.status === "starting") return { agentId: entry.session.id ?? undefined, status: "joining" };
    if (entry.session.status === "running") return { agentId: entry.session.id ?? undefined, status: entry.mode };
    return { agentId: entry.session.id ?? undefined, status: "offline" };
  }

  async setConversationMode(roomId: string, mode: ConversationMode) {
    const entry = this.require(roomId);
    entry.mode = mode;
    // GPT Live receives the standby policy when the session starts. Keep the
    // short-lived UI focus state locally because live sessions do not yet
    // expose a supported runtime instruction update.
  }

  async think(roomId: string, instruction: string) {
    await this.require(roomId).session.think(instruction, {
      on_listening_action: "inject",
      on_thinking_action: "interrupt",
      on_speaking_action: "interrupt",
      interruptable: true
    });
  }

  async say(roomId: string, text: string) {
    await this.require(roomId).session.say(text, { priority: "INTERRUPT", interruptable: true });
  }

  async interrupt(roomId: string) {
    const entry = this.sessions.get(roomId);
    if (entry) await entry.session.interrupt();
  }

  async getHistory(roomId: string) {
    return this.require(roomId).session.getHistory();
  }

  private require(roomId: string) {
    const entry = this.sessions.get(roomId);
    if (!entry || entry.session.status !== "running") throw new Error("Copilot is not running in this room");
    return entry;
  }
}

async function waitForAgentRunning(session: AgentSession) {
  const deadline = Date.now() + agentReadyTimeoutMs;
  while (Date.now() < deadline) {
    const info = await session.getInfo();
    if (info.status === "RUNNING") return;
    if (info.status === "FAILED" || info.status === "STOPPED") {
      throw new Error(`Agora GPT Live agent entered ${info.status} state${info.message ? `: ${info.message}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, agentReadyPollMs));
  }
  throw new Error("Agora GPT Live agent did not reach RUNNING state before the readiness timeout");
}

function normalizeRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not enabled|ServiceNotEnabled/i.test(message)) return new Error("Agora Conversational AI is not enabled for this project");
  if (/401|unauthorized|invalid.*key/i.test(message)) return new Error("Agora or OpenAI credentials were rejected");
  if (/503|ServiceUnavailable|agora-feature/i.test(message)) return new Error("Agora GPT Live is unavailable or not enabled for this project");
  if (/429|allocation|capacity/i.test(message)) return new Error("AI capacity is temporarily unavailable");
  return new Error(`GPT Live Copilot failed to join: ${message}`);
}
