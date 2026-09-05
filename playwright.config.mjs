import { defineConfig } from "@playwright/test";

/* PW_CHANNEL=msedge reproduces the original local setup; CI leaves it unset
   and runs the bundled Chromium, which ubuntu-latest can install. */
export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    browserName: "chromium",
    channel: process.env.PW_CHANNEL || undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});
