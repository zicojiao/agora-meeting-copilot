import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional()
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  STORAGE_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  DATABASE_URL: z.string().optional(),
  CAPABILITY_SECRET: z.string().min(24),
  WEBHOOK_SECRET: z.string().min(16),
  AGORA_APP_ID: z.string().length(32),
  AGORA_APP_CERTIFICATE: z.string().length(32),
  AGORA_CUSTOMER_ID: z.string().min(1).optional(),
  AGORA_CUSTOMER_SECRET: z.string().min(1).optional(),
  AGORA_STT_PUBLISHER_UID: z.string().regex(/^\d+$/).default("900003"),
  AGORA_STT_LANGUAGES: z.string().default("en-US"),
  AGORA_STT_MAX_IDLE_SECONDS: z.coerce.number().int().min(5).max(2_592_000).default(3600),
  OPENAI_API_KEY: z.string().min(20),
  OPENAI_GPT_LIVE_GREETING: optionalSecret,
  OPENAI_GPT_LIVE_DELEGATION_MODEL: z.string().default("gpt-5.5"),
  GPT_LIVE_PROXY_PUBLIC_URL: z.string().url().optional(),
  RAILWAY_PUBLIC_DOMAIN: optionalSecret,
  OPENAI_ANALYSIS_MODEL: z.string().default("gpt-5.4-mini"),
  ROOM_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  FEISHU_PUBLISH_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  FEISHU_APP_ID: optionalSecret,
  FEISHU_APP_SECRET: optionalSecret,
  FEISHU_WIKI_PARENT_TOKEN: optionalSecret,
  FEISHU_TARGET_CHAT_ID: optionalSecret,
  FEISHU_TENANT_DOMAIN: optionalSecret
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(env);
  if (value.GPT_LIVE_PROXY_PUBLIC_URL && !/^wss?:\/\//i.test(value.GPT_LIVE_PROXY_PUBLIC_URL)) {
    throw new Error("GPT_LIVE_PROXY_PUBLIC_URL must use ws:// or wss://");
  }
  if (value.NODE_ENV === "production" && !value.GPT_LIVE_PROXY_PUBLIC_URL && !value.RAILWAY_PUBLIC_DOMAIN) {
    throw new Error("GPT_LIVE_PROXY_PUBLIC_URL or RAILWAY_PUBLIC_DOMAIN is required in production");
  }
  if (value.STORAGE_DRIVER === "postgres" && !value.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  }
  if (Boolean(value.AGORA_CUSTOMER_ID) !== Boolean(value.AGORA_CUSTOMER_SECRET)) {
    throw new Error("AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET must be configured together");
  }
  const feishuValues = [
    value.FEISHU_APP_ID,
    value.FEISHU_APP_SECRET,
    value.FEISHU_WIKI_PARENT_TOKEN,
    value.FEISHU_TARGET_CHAT_ID,
    value.FEISHU_TENANT_DOMAIN
  ];
  const configuredFeishuValues = feishuValues.filter(Boolean).length;
  if (configuredFeishuValues > 0 && configuredFeishuValues !== feishuValues.length) {
    throw new Error("FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_WIKI_PARENT_TOKEN, FEISHU_TARGET_CHAT_ID, and FEISHU_TENANT_DOMAIN must be configured together");
  }
  if (value.FEISHU_APP_ID && !value.FEISHU_APP_ID.startsWith("cli_")) {
    throw new Error("FEISHU_APP_ID must start with cli_");
  }
  if (value.FEISHU_TARGET_CHAT_ID && !value.FEISHU_TARGET_CHAT_ID.startsWith("oc_")) {
    throw new Error("FEISHU_TARGET_CHAT_ID must start with oc_");
  }
  if (value.FEISHU_TENANT_DOMAIN && !/^[a-z0-9.-]+\.feishu\.cn$/i.test(value.FEISHU_TENANT_DOMAIN)) {
    throw new Error("FEISHU_TENANT_DOMAIN must be a Feishu tenant hostname without a protocol");
  }
  return {
    ...value,
    gptLiveProxyPublicUrl: (value.GPT_LIVE_PROXY_PUBLIC_URL
      ?? (value.RAILWAY_PUBLIC_DOMAIN ? `wss://${value.RAILWAY_PUBLIC_DOMAIN}` : `ws://127.0.0.1:${value.PORT}`))
      .replace(/\/$/, ""),
    allowedOrigins: value.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    agoraSttLanguages: value.AGORA_STT_LANGUAGES.split(",").map((language) => language.trim()).filter(Boolean).slice(0, 4),
    agoraSttEnabled: Boolean(value.AGORA_CUSTOMER_ID && value.AGORA_CUSTOMER_SECRET),
    roomTtlMs: value.ROOM_TTL_HOURS * 60 * 60 * 1000,
    feishu: value.FEISHU_PUBLISH_ENABLED && configuredFeishuValues === feishuValues.length ? {
      appId: value.FEISHU_APP_ID!,
      appSecret: value.FEISHU_APP_SECRET!,
      wikiParentToken: value.FEISHU_WIKI_PARENT_TOKEN!,
      targetChatId: value.FEISHU_TARGET_CHAT_ID!,
      tenantDomain: value.FEISHU_TENANT_DOMAIN!
    } : null
  };
}
