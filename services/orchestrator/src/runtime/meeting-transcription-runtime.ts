import agoraToken from "agora-token";
import type { Config } from "../config.js";
import type { TranscriptionStatus } from "../domain.js";

const { RtcRole, RtcTokenBuilder } = agoraToken;

export type StartMeetingTranscriptionInput = {
  roomId: string;
  channel: string;
};

export type MeetingTranscriptionRuntimeStatus = {
  providerSessionId: string;
  status: TranscriptionStatus;
  providerStatus: string;
};

export interface MeetingTranscriptionRuntime {
  start(input: StartMeetingTranscriptionInput): Promise<MeetingTranscriptionRuntimeStatus>;
  getStatus(providerSessionId: string): Promise<MeetingTranscriptionRuntimeStatus>;
  stop(providerSessionId: string): Promise<MeetingTranscriptionRuntimeStatus>;
  reconcile(providerSessionId: string): Promise<MeetingTranscriptionRuntimeStatus>;
}

type AgoraSttResponse = {
  agent_id?: string;
  status?: string;
  detail?: string;
  reason?: string;
  message?: string;
};

export class AgoraSttRuntime implements MeetingTranscriptionRuntime {
  constructor(
    private config: Config,
    private fetcher: typeof fetch = fetch
  ) {}

  async start(input: StartMeetingTranscriptionInput) {
    this.requireCredentials();
    const uid = Number(this.config.AGORA_STT_PUBLISHER_UID);
    const expiresIn = 6 * 60 * 60;
    const token = RtcTokenBuilder.buildTokenWithUid(
      this.config.AGORA_APP_ID,
      this.config.AGORA_APP_CERTIFICATE,
      input.channel,
      uid,
      RtcRole.PUBLISHER,
      expiresIn,
      expiresIn
    );
    const result = await this.request("/join", {
      method: "POST",
      body: JSON.stringify({
        languages: this.config.agoraSttLanguages,
        name: buildAgentName(input.roomId),
        maxIdleTime: this.config.AGORA_STT_MAX_IDLE_SECONDS,
        rtcConfig: {
          channelName: input.channel,
          pubBotUid: this.config.AGORA_STT_PUBLISHER_UID,
          pubBotToken: token
        }
      })
    });
    if (!result.agent_id) throw new Error("Agora STT did not return an agent ID");
    return runtimeStatus(result.agent_id, result.status);
  }

  async getStatus(providerSessionId: string) {
    const result = await this.request(`/agents/${encodeURIComponent(providerSessionId)}`);
    return runtimeStatus(result.agent_id || providerSessionId, result.status);
  }

  async stop(providerSessionId: string) {
    await this.request(`/agents/${encodeURIComponent(providerSessionId)}/leave`, { method: "POST" }, true);
    return { providerSessionId, status: "stopped" as const, providerStatus: "STOPPED" };
  }

  reconcile(providerSessionId: string) {
    return this.getStatus(providerSessionId);
  }

  private requireCredentials() {
    if (!this.config.AGORA_CUSTOMER_ID || !this.config.AGORA_CUSTOMER_SECRET) {
      throw Object.assign(new Error("Meeting transcription is not configured"), { statusCode: 503 });
    }
  }

  private async request(path: string, init: RequestInit = {}, allowEmpty = false): Promise<AgoraSttResponse> {
    this.requireCredentials();
    const authorization = Buffer.from(`${this.config.AGORA_CUSTOMER_ID}:${this.config.AGORA_CUSTOMER_SECRET}`).toString("base64");
    const response = await this.fetcher(
      `https://api.agora.io/api/speech-to-text/v1/projects/${this.config.AGORA_APP_ID}${path}`,
      {
        ...init,
        headers: {
          authorization: `Basic ${authorization}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers
        }
      }
    );
    const payload = await response.json().catch(() => ({})) as AgoraSttResponse;
    if (!response.ok) {
      throw new Error(payload.detail || payload.reason || payload.message || `Agora STT returned ${response.status}`);
    }
    if (!allowEmpty && !Object.keys(payload).length) throw new Error("Agora STT returned an empty response");
    return payload;
  }
}

export class NoopMeetingTranscriptionRuntime implements MeetingTranscriptionRuntime {
  async start(_input: StartMeetingTranscriptionInput): Promise<MeetingTranscriptionRuntimeStatus> { throw Object.assign(new Error("Meeting transcription is not configured"), { statusCode: 503 }); }
  async getStatus(providerSessionId: string) { return { providerSessionId, status: "error" as const, providerStatus: "UNAVAILABLE" }; }
  async stop(providerSessionId: string) { return { providerSessionId, status: "stopped" as const, providerStatus: "STOPPED" }; }
  reconcile(providerSessionId: string) { return this.getStatus(providerSessionId); }
}

function buildAgentName(roomId: string) {
  return `meeting-${roomId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-32)}-${Date.now().toString(36)}`.slice(0, 64);
}

function runtimeStatus(providerSessionId: string, providerStatus = "UNKNOWN"): MeetingTranscriptionRuntimeStatus {
  const status: TranscriptionStatus = providerStatus === "RUNNING"
    ? "active"
    : providerStatus === "STARTING" || providerStatus === "IDLE" || providerStatus === "RECOVERING"
      ? "starting"
      : providerStatus === "STOPPING"
        ? "stopping"
        : providerStatus === "STOPPED"
          ? "stopped"
          : "error";
  return { providerSessionId, status, providerStatus };
}
