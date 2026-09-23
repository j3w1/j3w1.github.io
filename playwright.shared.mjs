/* The repository's one set of Playwright settings, shared by the root suite
   and the j3w1ctl-auth suite. A plain object with no imports on purpose: each
   package's config must call defineConfig from its own @playwright/test, since
   loading a second copy of Playwright from another package's node_modules is
   refused at startup.

   PW_CHANNEL=msedge reproduces the original local setup; CI leaves it unset
   and runs the bundled Chromium, which ubuntu-latest can install. */
export const sharedConfig = Object.freeze({
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
