import type { Page } from "@playwright/test"

import { expect, test } from "./fixtures"

async function sendAndReceive(sender: Page, receiver: Page, text: string) {
  await sender.getByRole("textbox").fill(text)
  await sender.getByRole("button", { name: "Send", exact: true }).click()
  await expect(receiver.getByText(text, { exact: true })).toBeVisible()
}

for (const initiator of ["alice", "bob"] as const) {
  test(`video requested by ${initiator} reaches both participants and the other can return to chat`, async ({
    pair,
  }) => {
    await pair.enter()
    await pair.connect()
    const requester = pair[initiator]
    const recipient = pair[initiator === "alice" ? "bob" : "alice"]

    await requester.getByRole("button", { name: "Video", exact: true }).click()
    await expect(
      recipient.getByRole("heading", { name: "Start video call?" }),
    ).toBeVisible()
    await recipient.getByRole("button", { name: "Accept", exact: true }).click()

    for (const page of [pair.alice, pair.bob]) {
      await expect(
        page.getByRole("button", { name: "End video", exact: true }),
      ).toBeVisible()

      // The remote element is unmuted; the local preview is muted. Verify decoded
      // frames and live received audio, rather than merely a visible video panel.
      await expect
        .poll(
          () =>
            page.locator("video").evaluateAll((videos) =>
              videos.some((element) => {
                const video = element as HTMLVideoElement
                const stream = video.srcObject as MediaStream | null
                return (
                  !video.muted &&
                  video.readyState >= 2 &&
                  video.videoWidth > 0 &&
                  !!stream
                    ?.getAudioTracks()
                    .some((track) => track.readyState === "live")
                )
              }),
            ),
          { timeout: 30_000 },
        )
        .toBe(true)
    }

    await recipient
      .getByRole("button", { name: "End video", exact: true })
      .click()

    for (const page of [pair.alice, pair.bob]) {
      await expect(
        page.getByRole("button", { name: "End video", exact: true }),
      ).toHaveCount(0)
      await expect(page.getByRole("textbox")).toBeEnabled()
    }

    await recipient.getByRole("textbox").fill("Still connected after video")
    await recipient.getByRole("button", { name: "Send", exact: true }).click()
    await expect(
      requester.getByText("Still connected after video", { exact: true }),
    ).toBeVisible()
  })
}

test("declining video preserves chat and permits another video request", async ({
  pair,
}) => {
  for (const page of [pair.alice, pair.bob]) {
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      )
      const capture = { calls: 0 }
      Object.defineProperty(window, "__testMediaCapture", { value: capture })
      navigator.mediaDevices.getUserMedia = (constraints) => {
        capture.calls++
        return original(constraints)
      }
    })
  }

  await pair.enter()
  await pair.connect()
  await pair.alice.getByRole("button", { name: "Video", exact: true }).click()

  const prompt = pair.bob.getByRole("heading", { name: "Start video call?" })
  await expect(prompt).toBeVisible()

  for (const page of [pair.alice, pair.bob]) {
    await expect(page.locator("video")).toHaveCount(0)
    expect(
      await page.evaluate(
        () =>
          (Reflect.get(window, "__testMediaCapture") as { calls: number })
            .calls,
      ),
    ).toBe(0)
  }

  await pair.bob.getByRole("button", { name: "Decline", exact: true }).click()
  await expect(
    pair.alice.getByText("Video declined.", { exact: true }),
  ).toBeVisible()
  await expect(prompt).toHaveCount(0)
  await sendAndReceive(pair.bob, pair.alice, "Text chat after declining video")
  await pair.bob.getByRole("button", { name: "Video", exact: true }).click()
  await expect(
    pair.alice.getByRole("heading", { name: "Start video call?" }),
  ).toBeVisible()
})

for (const deniedSide of ["alice", "bob"] as const) {
  test(`a media permission failure on ${deniedSide} returns both participants to usable chat`, async ({
    pair,
  }) => {
    await pair.enter()
    await pair.connect()

    await pair[deniedSide].evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: () =>
          Promise.reject(
            new DOMException("Test media denial", "NotAllowedError"),
          ),
      })
    })

    await pair.alice.getByRole("button", { name: "Video", exact: true }).click()
    await expect(
      pair.bob.getByRole("heading", { name: "Start video call?" }),
    ).toBeVisible()
    await pair.bob.getByRole("button", { name: "Accept", exact: true }).click()
    await expect(
      pair[deniedSide].getByText("Camera unavailable.", { exact: true }),
    ).toBeVisible()

    for (const page of [pair.alice, pair.bob]) {
      await expect(
        page.getByRole("button", { name: "Video", exact: true }),
      ).toBeEnabled()
      await expect(page.locator("video")).toHaveCount(0)
      await expect(page.getByRole("textbox")).toBeEnabled()
    }

    await sendAndReceive(pair.alice, pair.bob, "Text chat after media denial")
  })
}
