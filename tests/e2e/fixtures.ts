import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import { BASE_URL } from "./config"
import type { SessionCredentials } from "../../lib/session"
import type { MapLocation } from "../../lib/types"

interface JoinResult extends SessionCredentials {
  location: MapLocation
}

interface EnteredParticipant {
  id: string
  lat: number
  lng: number
  location: MapLocation
}

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
      if (/^\/styles\/v1\/mapbox\/(light|dark)-v11$/.test(url.pathname)) {
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

export async function enterParticipant(
  page: Page,
): Promise<EnteredParticipant> {
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

  const { id, location } = (await response.json()) as JoinResult
  const { lat, lng } = response.request().postDataJSON()

  return { id, lat, lng, location }
}

export const test = base.extend<{ pair: Pair }>({
  pair: async ({ browser, request }, runTest) => {
    const contexts: BrowserContext[] = []
    const sessions = new Map<string, SessionCredentials>()
    const captures: Promise<void>[] = []

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

        page.on("response", (response) => {
          if (
            new URL(response.url()).pathname === "/api/join" &&
            response.request().method() === "POST" &&
            response.status() === 200
          ) {
            captures.push(
              response.json().then((body: SessionCredentials) => {
                sessions.set(body.id, { id: body.id, token: body.token })
              }),
            )
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
      // Read join responses before closing contexts so cleanup retains ownership.
      const captured = await Promise.allSettled(captures)

      for (const context of contexts) await context.close()

      // Clean only this test's sessions, including partial joins and failed tests.
      // Explicit cleanup is a fallback; tests of tab-close cleanup assert first.
      for (const credentials of sessions.values()) {
        const response = await request.post("/api/leave", { data: credentials })

        // A successful page-close beacon may already have removed the session.
        expect(
          [200, 401],
          "session is removed or no longer authenticates",
        ).toContain(response.status())
      }

      expect(
        captured.every((result) => result.status === "fulfilled"),
        "joined sessions were captured for cleanup",
      ).toBe(true)
    }
  },
})

export { expect } from "@playwright/test"
