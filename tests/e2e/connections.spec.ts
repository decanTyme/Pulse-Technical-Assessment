import type { Page } from "@playwright/test"

import { enterParticipant, expect, test } from "./fixtures"

async function sendAndReceive(sender: Page, receiver: Page, text: string) {
  await sender.getByRole("textbox").fill(text)
  await sender.getByRole("button", { name: "Send", exact: true }).click()
  await expect(receiver.getByText(text, { exact: true })).toBeVisible()
}

test("declining a request informs the initiator and permits another request", async ({
  pair,
}) => {
  await pair.enter()

  await pair.alice.getByTitle("Tap to connect", { exact: true }).click()
  await expect(
    pair.bob.getByRole("heading", { name: "A stranger wants to connect" }),
  ).toBeVisible()
  await expect(pair.alice.getByRole("textbox")).toHaveCount(0)
  await expect(pair.bob.getByRole("textbox")).toHaveCount(0)
  await pair.bob.getByRole("button", { name: "Decline", exact: true }).click()
  await expect(
    pair.alice.getByText("Request declined.", { exact: true }),
  ).toBeVisible()
  await pair.alice.getByTitle("Tap to connect", { exact: true }).click()
  await expect(
    pair.bob.getByRole("heading", { name: "A stranger wants to connect" }),
  ).toBeVisible()
})

test("accepted chat delivers messages in both directions", async ({ pair }) => {
  await pair.enter()
  await pair.connect()

  await pair.alice.getByRole("textbox").fill("Hello from Alice")
  await pair.alice.getByRole("button", { name: "Send", exact: true }).click()
  await expect(
    pair.bob.getByText("Hello from Alice", { exact: true }),
  ).toBeVisible()
  await pair.bob.getByRole("textbox").fill("Hello from Bob")
  await pair.bob.getByRole("button", { name: "Send", exact: true }).click()
  await expect(
    pair.alice.getByText("Hello from Bob", { exact: true }),
  ).toBeVisible()
})

test("ending a connection informs the other participant and permits reconnection", async ({
  pair,
}) => {
  await pair.enter()
  await pair.connect()

  await pair.alice.getByRole("button", { name: "End", exact: true }).click()
  await expect(
    pair.bob.getByText("Stranger disconnected.", { exact: true }),
  ).toBeVisible()
  await expect(pair.alice.getByRole("textbox")).toHaveCount(0)
  await expect(pair.bob.getByRole("textbox")).toHaveCount(0)
  await pair.connect()
})

test("an ignored connection request times out, clears the prompt, and permits retry", async ({
  pair,
}) => {
  // Install before navigation so application timers use the controlled clock.
  // Only browser time advances; database expiry still uses the real server clock.
  await pair.alice.clock.install()
  await pair.enter()
  await pair.alice.getByTitle("Tap to connect", { exact: true }).click()
  await expect(
    pair.bob.getByRole("heading", { name: "A stranger wants to connect" }),
  ).toBeVisible()
  await expect(pair.alice.getByRole("textbox")).toHaveCount(0)
  await expect(pair.bob.getByRole("textbox")).toHaveCount(0)

  await pair.alice.clock.fastForward(30_001)
  await expect(
    pair.alice.getByText("No answer.", { exact: true }),
  ).toBeVisible()
  await expect(
    pair.bob.getByRole("heading", { name: "A stranger wants to connect" }),
  ).toHaveCount(0)
  await pair.alice.getByTitle("Tap to connect", { exact: true }).click()
  await expect(
    pair.bob.getByRole("heading", { name: "A stranger wants to connect" }),
  ).toBeVisible()
})

test("a third participant cannot interrupt an active connection", async ({
  pair,
}) => {
  await pair.enter()
  await pair.connect()
  const third = await pair.addParticipant()
  await enterParticipant(third)
  await expect(third.getByTitle("Tap to connect", { exact: true })).toHaveCount(
    2,
  )
  await third.getByTitle("Tap to connect", { exact: true }).first().click()
  await expect(
    third.getByText("Request declined.", { exact: true }),
  ).toBeVisible()
  await expect(third.getByRole("textbox")).toHaveCount(0)
  await expect(
    pair.alice.getByRole("heading", { name: "A stranger wants to connect" }),
  ).toHaveCount(0)
  await expect(
    pair.bob.getByRole("heading", { name: "A stranger wants to connect" }),
  ).toHaveCount(0)
  await sendAndReceive(pair.alice, pair.bob, "Our original chat still works")
})

test("closing a connected tab ends the other participant's chat and removes its dot", async ({
  pair,
}) => {
  await pair.enter()
  await pair.connect()
  await pair.bob.close()
  await expect(pair.alice.getByRole("textbox")).toHaveCount(0, {
    timeout: 8_000,
  })
  await expect(
    pair.alice.getByTitle("Tap to connect", { exact: true }),
  ).toHaveCount(0, { timeout: 8_000 })
  await expect(pair.alice.getByText("0 online", { exact: true })).toBeVisible()
})
