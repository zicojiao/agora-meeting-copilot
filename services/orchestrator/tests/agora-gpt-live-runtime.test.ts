import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { AgoraConvoAiRuntimeAdapter } from "../src/runtime/agora-convo-ai-runtime.js";
import { meetingInstructions } from "../src/runtime/prompts.js";

const config = loadConfig({
  NODE_ENV: "test",
  CAPABILITY_SECRET: "test-capability-secret-at-least-24",
  WEBHOOK_SECRET: "test-webhook-secret",
  AGORA_APP_ID: "a".repeat(32),
  AGORA_APP_CERTIFICATE: "b".repeat(32),
  OPENAI_API_KEY: "sk-test-key-long-enough-for-tests",
  OPENAI_GPT_LIVE_GREETING: "Hello from GPT Live."
});

function okFetch() {
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) =>
    new Response(JSON.stringify(
      init?.method === "GET" && String(input).includes("/agents/gpt-live-agent-1")
        ? { agent_id: "gpt-live-agent-1", status: "RUNNING", message: "ok" }
        : { agent_id: "gpt-live-agent-1", data: { list: [] } }
    ), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
}

describe("Agora GPT Live runtime", () => {
  it("starts an MLLM-only agent through the preview gateway", async () => {
    const fetcher = okFetch();
    const runtime = new AgoraConvoAiRuntimeAdapter(config, fetcher);

    await expect(runtime.start({
      roomId: "meet-preview",
      channel: "meet-preview",
      remoteUids: ["*"]
    })).resolves.toEqual({ agentId: "gpt-live-agent-1", status: "standby" });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      `https://partner.ai.agora.io/preview/api/conversational-ai-agent/v2/projects/${config.AGORA_APP_ID}/join`
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toMatch(/^agora token=/);
    expect(headers.get("agora-feature")).toBe("gemini-live");

    const request = JSON.parse(String(init?.body)) as {
      name: string;
      properties: Record<string, unknown>;
    };
    expect(request.name).toMatch(/^meeting-meet-preview-/);
    expect(request.properties).toMatchObject({
      channel: "meet-preview",
      agent_rtc_uid: "900001",
      remote_rtc_uids: ["*"],
      advanced_features: { enable_rtm: true, enable_tools: false },
      parameters: {
        audio_scenario: "chorus",
        data_channel: "rtm",
        enable_error_message: true,
        enable_metrics: true
      },
      mllm: {
        enable: true,
        vendor: "openai_gpt_live",
        api_key: expect.not.stringMatching(/^sk-/),
        url: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:8787\/gpt-live\/meet-preview\?model=gpt-live-1-lava-alpha&expires=\d+&signature=/),
        params: {
          instructions: meetingInstructions("standby")
        },
        greeting: "Hello from GPT Live.",
        greeting_message: "Hello from GPT Live."
      },
      turn_detection: { language: "en-US" }
    });
    expect(request.properties).not.toHaveProperty("asr");
    expect(request.properties).not.toHaveProperty("llm");
    expect(request.properties).not.toHaveProperty("tts");
  });

  it("includes initial meeting context in GPT Live instructions", async () => {
    const fetcher = okFetch();
    const runtime = new AgoraConvoAiRuntimeAdapter(config, fetcher);

    await runtime.start({
      roomId: "meet-context",
      channel: "meet-context",
      remoteUids: ["101"],
      initialContext: "The launch owner is Zico."
    });

    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.properties.mllm.params.instructions).toContain(
      "# Recent Meeting Context\nThe launch owner is Zico."
    );
  });

  it("keeps the preview gate on stop and does not send unsupported focus updates", async () => {
    const fetcher = okFetch();
    const runtime = new AgoraConvoAiRuntimeAdapter(config, fetcher);
    await runtime.start({ roomId: "meet-lifecycle", channel: "meet-lifecycle", remoteUids: ["101"] });

    await runtime.setConversationMode("meet-lifecycle", "focused");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(runtime.getStatus("meet-lifecycle")).resolves.toEqual({
      agentId: "gpt-live-agent-1",
      status: "focused"
    });

    await runtime.stop("meet-lifecycle");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [stopUrl, stopInit] = fetcher.mock.calls[2];
    expect(String(stopUrl)).toContain("/agents/gpt-live-agent-1/leave");
    expect(new Headers(stopInit?.headers).get("agora-feature")).toBe("gemini-live");
  });

  it("stops and clears the session when the accepted agent later fails readiness", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const body = init?.method === "GET" && String(input).includes("/agents/gpt-live-agent-1")
        ? { agent_id: "gpt-live-agent-1", status: "FAILED", message: "provider startup failed" }
        : { agent_id: "gpt-live-agent-1" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const runtime = new AgoraConvoAiRuntimeAdapter(config, fetcher);

    await expect(runtime.start({
      roomId: "meet-readiness-failure",
      channel: "meet-readiness-failure",
      remoteUids: ["101"]
    })).rejects.toThrow("provider startup failed");

    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain("/agents/gpt-live-agent-1/leave");
    await expect(runtime.getStatus("meet-readiness-failure")).resolves.toEqual({ status: "offline" });
  });

  it("clears partial local state when the preview gateway rejects start", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "preview route unavailable", reason: "ServiceUnavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    );
    const runtime = new AgoraConvoAiRuntimeAdapter(config, fetcher);

    await expect(runtime.start({
      roomId: "meet-failure",
      channel: "meet-failure",
      remoteUids: ["101"]
    })).rejects.toThrow("Agora GPT Live preview is unavailable or not enabled for this project");
    await expect(runtime.getStatus("meet-failure")).resolves.toEqual({ status: "offline" });
  });

  it("stops a persisted agent after a local runtime restart", async () => {
    const fetcher = okFetch();
    const runtime = new AgoraConvoAiRuntimeAdapter(config, fetcher);
    await runtime.stop("meet-detached", "agent-detached");
    expect(String(fetcher.mock.calls[0][0])).toContain("/agents/agent-detached/leave");
  });
});
