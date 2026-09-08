import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1",
        // Browser scenarios mock Supabase and exercise cross-origin HTTPS assets.
        // Keep their fixture independent of the shell's/local .env API settings.
        env: {
          VITE_SUPABASE_URL: "https://supabase.e2e.test",
          VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
          VITE_SUPABASE_STORAGE_BUCKET: "survey-files",
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: baseURL,
      },
});
