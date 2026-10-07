import { defineConfig } from "@playwright/test"
import { BASE_URL, resolveDatabaseURL } from "./tests/e2e/config"

const databaseURL = resolveDatabaseURL()

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",

  // Presence is global to the database. Serial scenarios keep peer counts exact.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-first-failure",
    video: "off",
  },

  webServer: {
    command: "npm run build && npm run start",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,

    env: {
      DATABASE_URL: databaseURL,
      // The fixture intercepts Mapbox downloads and supplies a blank style.
      NEXT_PUBLIC_MAPBOX_TOKEN: "pk.e2e-placeholder",
    },
  },

  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        launchOptions: {
          // Temporary assessment workaround: newPage hangs in the restricted Windows runner.
          // Disables content-process isolation; remove for normal test environments.
          // No matching upstream issue found; Mozilla documents this debugging override:
          // https://firefox-source-docs.mozilla.org/contributing/debugging/debugging_on_windows.html#console-debugging
          env:
            process.platform === "win32"
              ? { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" }
              : undefined,

          firefoxUserPrefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.permission.disabled": true,
            "media.autoplay.default": 0,
          },
        },
      },
    },
  ],
})
