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
  retries: 1,
  failOnFlakyTests: true,
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
  ],
})
