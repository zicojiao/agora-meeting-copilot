import {
  OPENAI_GPT_LIVE_URL,
  OpenAIGPTLive,
  type MllmConfig,
  type OpenAIGPTLiveOptions
} from "agora-agents";

export type MeetingGptLiveOptions = OpenAIGPTLiveOptions & {
  instructions: string;
  model: string;
};

/**
 * Adds meeting instructions to Agora's GPT Live preview vendor config while
 * retaining the SDK's preview URL, credentials, and greeting aliases.
 */
export class MeetingGptLive extends OpenAIGPTLive {
  private readonly instructions: string;

  constructor(options: MeetingGptLiveOptions) {
    const { instructions, model, ...gptLiveOptions } = options;
    const url = new URL(gptLiveOptions.url ?? OPENAI_GPT_LIVE_URL);
    url.searchParams.set("model", model);
    super({ ...gptLiveOptions, url: url.toString() });
    this.instructions = instructions;
  }

  override toConfig(): MllmConfig {
    const config = super.toConfig();
    return {
      ...config,
      params: {
        ...config.params,
        instructions: this.instructions
      }
    };
  }
}
