import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  NODE_ENV: "test",
  CAPABILITY_SECRET: "test-capability-secret-at-least-24",
  WEBHOOK_SECRET: "test-webhook-secret",
  AGORA_APP_ID: "a".repeat(32),
  AGORA_APP_CERTIFICATE: "b".repeat(32),
  OPENAI_API_KEY: "sk-test-key-long-enough-for-tests"
};

describe("orchestrator config", () => {
  it("uses GPT Live without requiring a model environment variable", () => {
    const config = loadConfig(baseEnv);
    expect(config.OPENAI_KEY_MODE).toBe("byok");
    expect(config.OPENAI_GPT_LIVE_GREETING).toBeUndefined();
    expect(config).not.toHaveProperty("OPENAI_REALTIME_MODEL");
  });

  it("requires an environment key only in explicit server mode", () => {
    expect(() => loadConfig({ ...baseEnv, OPENAI_KEY_MODE: "server", OPENAI_API_KEY: "" })).toThrow("OPENAI_API_KEY is required");
    expect(loadConfig({ ...baseEnv, OPENAI_KEY_MODE: "server" }).OPENAI_API_KEY).toBe(baseEnv.OPENAI_API_KEY);
  });

  it("defaults meeting transcription to English while allowing an explicit multilingual override", () => {
    expect(loadConfig(baseEnv).agoraSttLanguages).toEqual(["en-US"]);
    expect(loadConfig({ ...baseEnv, AGORA_STT_LANGUAGES: "en-US,zh-CN" }).agoraSttLanguages).toEqual([
      "en-US",
      "zh-CN"
    ]);
  });

  it("derives the public GPT Live WSS gateway on Railway", () => {
    expect(loadConfig({ ...baseEnv, NODE_ENV: "production", RAILWAY_PUBLIC_DOMAIN: "orchestrator.example.com" }).gptLiveProxyPublicUrl)
      .toBe("wss://orchestrator.example.com");
  });

  it("rejects non-WebSocket GPT Live proxy URLs", () => {
    expect(() => loadConfig({ ...baseEnv, GPT_LIVE_PROXY_PUBLIC_URL: "https://orchestrator.example.com" })).toThrow("must use ws:// or wss://");
  });

  it("keeps the internal Feishu publisher disabled by default", () => {
    expect(loadConfig(baseEnv).feishu).toBeNull();
  });

  it("enables the publisher only when every Feishu setting is present", () => {
    expect(loadConfig({
      ...baseEnv,
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret",
      FEISHU_WIKI_PARENT_TOKEN: "wiki-parent",
      FEISHU_TARGET_CHAT_ID: "oc_test",
      FEISHU_TENANT_DOMAIN: "example.feishu.cn"
    }).feishu).toEqual({
      appId: "cli_test",
      appSecret: "secret",
      wikiParentToken: "wiki-parent",
      targetChatId: "oc_test",
      tenantDomain: "example.feishu.cn"
    });
  });

  it("keeps Feishu credentials configured while the publisher switch is off", () => {
    const config = loadConfig({
      ...baseEnv,
      FEISHU_PUBLISH_ENABLED: "false",
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret",
      FEISHU_WIKI_PARENT_TOKEN: "wiki-parent",
      FEISHU_TARGET_CHAT_ID: "oc_test",
      FEISHU_TENANT_DOMAIN: "example.feishu.cn"
    });

    expect(config.FEISHU_PUBLISH_ENABLED).toBe(false);
    expect(config.FEISHU_APP_ID).toBe("cli_test");
    expect(config.feishu).toBeNull();
  });

  it("enables configured Feishu publishing when the switch is on", () => {
    expect(loadConfig({
      ...baseEnv,
      FEISHU_PUBLISH_ENABLED: "true",
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret",
      FEISHU_WIKI_PARENT_TOKEN: "wiki-parent",
      FEISHU_TARGET_CHAT_ID: "oc_test",
      FEISHU_TENANT_DOMAIN: "example.feishu.cn"
    }).feishu).not.toBeNull();
  });

  it("rejects partial Feishu configuration instead of silently disabling it", () => {
    expect(() => loadConfig({
      ...baseEnv,
      FEISHU_APP_ID: "cli_test"
    })).toThrow(/must be configured together/);
  });
});
