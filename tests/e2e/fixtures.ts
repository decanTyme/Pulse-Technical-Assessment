import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import { BASE_URL } from "./config"

interface Pair {
  alice: Page
  bob: Page
  enter: () => Promise<void>
  connect: () => Promise<void>
  addParticipant: () => Promise<Page>
}

// Synthetic city coordinates, unrelated to either participant's actual location.
export const LOCATIONS = [
  { latitude: 14.5995, longitude: 120.9842 },
  { latitude: 10.3157, longitude: 123.8854 },
]

export async function mockMapDownloads(context: BrowserContext) {
  await context.route(
    /^https:\/\/(api|events)\.mapbox\.com\//,
    async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === "/styles/v1/mapbox/dark-v11") {
        await route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#18181b" },
              },
            ],
          },
        })
      } else {
        await route.fulfill({ status: 204 })
      }
    },
  )
}

export async function enterParticipant(page: Page) {
  await page.goto("/")

  const joined = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/join" &&
      response.request().method() === "POST",
  )

  await page.getByRole("button", { name: "Enter Pulse", exact: true }).click()
  const response = await joined
  expect(response.status(), "the real join API succeeds").toBe(200)
  await expect(page.getByTitle("You are here", { exact: true })).toBeVisible()

  return response.request().postDataJSON() as {
    id: string
    lat: number
    lng: number
  }
}

export const test = base.extend<{ pair: Pair }>({
  pair: async ({ browser, request }, runTest) => {
    const contexts: BrowserContext[] = []
    const sessionIds = new Set<string>()

    try {
      const createParticipant = async (
        geolocation: (typeof LOCATIONS)[number],
      ) => {
        const context = await browser.newContext({
          baseURL: BASE_URL,
          viewport: { width: 1280, height: 800 },
          permissions: ["geolocation"],
          geolocation,
          serviceWorkers: "block",
        })

        contexts.push(context)
        await mockMapDownloads(context)

        const page = await context.newPage()

        page.on("request", (request) => {
          if (
            new URL(request.url()).pathname === "/api/join" &&
            request.method() === "POST"
          ) {
            const body = request.postDataJSON()
            if (typeof body?.id === "string") sessionIds.add(body.id)
          }
        })

        return page
      }

      const alice = await createParticipant(LOCATIONS[0])
      const bob = await createParticipant(LOCATIONS[1])

      await runTest({
        alice,
        bob,
        enter: async () => {
          await enterParticipant(alice)
          await enterParticipant(bob)
          // Mapbox 3 assigns role="img" to custom marker elements, including
          // these buttons. Their existing title remains a stable user-facing locator.
          await expect(
            alice.getByTitle("Tap to connect", { exact: true }),
          ).toHaveCount(1)
          await expect(
            bob.getByTitle("Tap to connect", { exact: true }),
          ).toHaveCount(1)
        },
        connect: async () => {
          await alice.getByTitle("Tap to connect", { exact: true }).click()
          await expect(
            bob.getByRole("heading", { name: "A stranger wants to connect" }),
          ).toBeVisible()
          await bob.getByRole("button", { name: "Accept", exact: true }).click()
          // Enabled input proves the RTCDataChannel opened, not just that the panel mounted.
          await expect(alice.getByRole("textbox")).toBeEnabled({
            timeout: 30_000,
          })
          await expect(bob.getByRole("textbox")).toBeEnabled({
            timeout: 30_000,
          })
        },
        addParticipant: () =>
          createParticipant({ latitude: 12.4556, longitude: 122.4348 }),
      })
    } finally {
      for (const context of contexts) await context.close()

      // Clean only this test's sessions, including partial joins and failed tests.
      // Explicit cleanup is a fallback; tests of tab-close cleanup assert first.
      for (const id of sessionIds) {
        const response = await request.post("/api/leave", { data: { id } })
        expect(response.status(), "test session cleanup succeeds").toBe(200)
      }
    }
  },
})

export { expect } from "@playwright/test"
