import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { AgoraSttRuntime } from "../src/runtime/meeting-transcription-runtime.js";

describe("AgoraSttRuntime", () => {
  it("uses the v7 join API with one subtitle publisher UID", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ agent_id: "stt-agent", status: "RUNNING" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const config = {
      AGORA_APP_ID: "a".repeat(32),
      AGORA_APP_CERTIFICATE: "b".repeat(32),
      AGORA_CUSTOMER_ID: "customer-id",
      AGORA_CUSTOMER_SECRET: "customer-secret",
      AGORA_STT_PUBLISHER_UID: "900003",
      AGORA_STT_MAX_IDLE_SECONDS: 3600,
      agoraSttLanguages: ["en-US"]
    } as Config;
    const runtime = new AgoraSttRuntime(config, fetcher);

    await expect(runtime.start({ roomId: "meet-devx", channel: "meet-devx" })).resolves.toMatchObject({ providerSessionId: "stt-agent", status: "active" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.agora.io/api/speech-to-text/v1/projects/${config.AGORA_APP_ID}/join`);
    expect(calls[0].init?.headers).toMatchObject({ authorization: `Basic ${Buffer.from("customer-id:customer-secret").toString("base64")}` });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.languages).toEqual(["en-US"]);
    expect(body.rtcConfig.pubBotUid).toBe("900003");
    expect(body.rtcConfig.pubBotToken).toBeTruthy();
    expect(body.rtcConfig).not.toHaveProperty("subBotUid");
    expect(body).not.toHaveProperty("captionConfig");
  });
});
