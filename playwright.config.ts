import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: "http://127.0.0.1:3101",
    permissions: ["camera", "microphone"],
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: "node tests/mock-orchestrator.mjs",
      url: "http://127.0.0.1:8787/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: "npm run dev -- --port 3101",
      env: {
        ...process.env,
        DEMO_ACCESS_PASSWORD: "devx",
        DEMO_ACCESS_TOKEN: "playwright-session-token-not-a-production-secret"
      },
      url: "http://127.0.0.1:3101",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
        }
      }
    }
  ]
});
