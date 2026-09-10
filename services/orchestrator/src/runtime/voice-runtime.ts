import type { AgentStatus, ConversationMode } from "../domain.js";

export type StartVoiceRuntimeInput = {
  roomId: string;
  channel: string;
  remoteUids: string[];
  initialContext?: string;
};

export type RuntimeStatus = { agentId?: string; status: AgentStatus; detail?: string };

export interface VoiceRuntimeAdapter {
  start(input: StartVoiceRuntimeInput): Promise<RuntimeStatus>;
  stop(roomId: string, agentId?: string): Promise<void>;
  getStatus(roomId: string): Promise<RuntimeStatus>;
  setConversationMode(roomId: string, mode: ConversationMode): Promise<void>;
  think(roomId: string, instruction: string): Promise<void>;
  say(roomId: string, text: string): Promise<void>;
  interrupt(roomId: string): Promise<void>;
  getHistory(roomId: string): Promise<unknown>;
}
