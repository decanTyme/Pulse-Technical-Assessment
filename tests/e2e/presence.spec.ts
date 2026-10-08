import type { Page } from "@playwright/test"

import type { PeerDot, PollResponse } from "../../lib/types"

import { enterParticipant, expect, LOCATIONS, test } from "./fixtures"

// Observe the browser's own poll; a separate API poll could consume its signals.
async function visiblePeer(page: Page, id: string): Promise<PeerDot> {
  const response = await page.waitForResponse(async (response) => {
    if (new URL(response.url()).pathname !== "/api/poll" || !response.ok())
      return false
    const data: PollResponse = await response.json()
    return data.peers.some((peer) => peer.id === id)
  })

  const data: PollResponse = await response.json()

  return data.peers.find((peer) => peer.id === id)!
}

// Independent great-circle distance, rather than reusing the offset implementation.
function distanceKm(
  origin: (typeof LOCATIONS)[number],
  dot: Pick<PeerDot, "lat" | "lng">,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180

  const dLat = radians(dot.lat - origin.latitude)
  const dLng = radians(dot.lng - origin.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(origin.latitude)) *
      Math.cos(radians(dot.lat)) *
      Math.sin(dLng / 2) ** 2

  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

test("two participants see each other, and a clean departure removes the dot", async ({
  pair,
}) => {
  await pair.enter()

  await expect(pair.alice.getByText("1 online", { exact: true })).toBeVisible()
  // Navigate away to exercise pagehide/beacon while the browser remains alive.
  await pair.bob.goto("about:blank")
  // Less than the 15-second stale timeout: fallback expiry must not mask a broken beacon.
  await expect(
    pair.alice.getByTitle("Tap to connect", { exact: true }),
  ).toHaveCount(0, { timeout: 8_000 })
  await expect(pair.alice.getByText("0 online", { exact: true })).toBeVisible()
})

test("an unclean departure expires even while the other participant keeps polling", async ({
  pair,
}) => {
  await pair.enter()

  // Stop heartbeats without sending leave. Alice continues the real poll loop.
  await pair.bob.route("**/api/poll?**", (route) => route.abort())
  await expect(
    pair.alice.getByTitle("Tap to connect", { exact: true }),
  ).toHaveCount(0, { timeout: 30_000 })
})

test("a fresh session broadcasts a new privacy offset without retaining the old dot", async ({
  pair,
}) => {
  const firstSession = await enterParticipant(pair.alice)
  await enterParticipant(pair.bob)
  const firstDot = await visiblePeer(pair.bob, firstSession.id)
  expect({ lat: firstDot.lat, lng: firstDot.lng }).toEqual(
    firstSession.location,
  )

  // Allow 10 m for the starter's approximate degree-to-kilometre conversion.
  expect(distanceKm(LOCATIONS[0], firstDot)).toBeGreaterThanOrEqual(0.99)
  expect(distanceKm(LOCATIONS[0], firstDot)).toBeLessThanOrEqual(3.01)

  await pair.alice.goto("about:blank")
  await expect(
    pair.bob.getByTitle("Tap to connect", { exact: true }),
  ).toHaveCount(0, { timeout: 8_000 })

  const nextSession = await enterParticipant(pair.alice)
  const nextDot = await visiblePeer(pair.bob, nextSession.id)
  expect({ lat: nextDot.lat, lng: nextDot.lng }).toEqual(nextSession.location)
  expect(nextSession.id).not.toBe(firstSession.id)
  expect(distanceKm(LOCATIONS[0], nextDot)).toBeGreaterThanOrEqual(0.99)
  expect(distanceKm(LOCATIONS[0], nextDot)).toBeLessThanOrEqual(3.01)
  expect({ lat: nextDot.lat, lng: nextDot.lng }).not.toEqual({
    lat: firstDot.lat,
    lng: firstDot.lng,
  })
  await expect(
    pair.bob.getByTitle("Tap to connect", { exact: true }),
  ).toHaveCount(1)
  await expect(pair.alice.getByRole("textbox")).toHaveCount(0)
})

test("discovery distinguishes loading, an empty globe, and interrupted live updates", async ({
  pair,
}) => {
  const page = pair.alice
  const firstPoll = Promise.withResolvers<void>()
  await page.route(
    "**/api/poll?**",
    async (route) => {
      await firstPoll.promise
      await route.continue()
    },
    { times: 1 },
  )

  try {
    await enterParticipant(page)
    await expect(
      page.getByRole("heading", { name: "Finding people…" }),
    ).toBeVisible()
    await expect(page.getByText("0 online", { exact: true })).toHaveCount(0)
  } finally {
    firstPoll.resolve()
  }

  const emptyState = page.getByRole("heading", {
    name: "A quiet moment on the globe.",
  })
  await expect(emptyState).toBeVisible()
  await expect(page.getByText("0 online", { exact: true })).toBeVisible()

  await page.route(
    "**/api/poll?**",
    (route) => route.fulfill({ status: 503 }),
    { times: 1 },
  )
  await expect(
    page.getByRole("heading", { name: "Live updates paused" }),
  ).toBeVisible()
  await expect(page.getByText("0 online", { exact: true })).toHaveCount(0)
  await expect(emptyState).toBeVisible()
  await expect(page.getByText("0 online", { exact: true })).toBeVisible()
})

test("the live map responds to zoom and pan gestures", async ({ pair }) => {
  await pair.alice.emulateMedia({ reducedMotion: "reduce" })
  await pair.enter()
  const canvas = pair.alice.locator(".mapboxgl-canvas")
  const dot = pair.alice.getByTitle("Tap to connect", { exact: true })
  await expect(canvas).toBeVisible()

  const initialPosition = await dot.evaluate(
    (element) => element.style.transform,
  )
  await canvas.dblclick({ position: { x: 200, y: 200 } })
  await expect
    .poll(() => dot.evaluate((element) => element.style.transform))
    .not.toBe(initialPosition)

  // Reduced motion makes the zoom finish before measuring the separate pan.
  const beforePan = await dot.boundingBox()
  expect(beforePan).not.toBeNull()
  await pair.alice.mouse.move(400, 250)
  await pair.alice.mouse.down()
  await pair.alice.mouse.move(500, 300, { steps: 10 })
  await pair.alice.mouse.up()
  await expect
    .poll(async () => {
      const afterPan = await dot.boundingBox()
      return afterPan
        ? Math.hypot(afterPan.x - beforePan!.x, afterPan.y - beforePan!.y)
        : 0
    })
    .toBeGreaterThan(0)
})
