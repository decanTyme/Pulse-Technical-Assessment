import { expect, test } from "./fixtures"

test("entry explains the anonymous session and offers an enabled action", async ({
  page,
}) => {
  await page.goto("/")

  await expect(page).toHaveTitle("Pulse")
  await expect(
    page.getByRole("heading", { name: "Pulse", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Enter Pulse", exact: true }),
  ).toBeEnabled()
  await expect(page.getByText(/No sign-up/)).toBeVisible()
})

test("denied location stays at the gate and allows another attempt", async ({
  page,
}) => {
  // Emulate a browser error, without depending on a native permission dialog.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      value: (_success: PositionCallback, failure: PositionErrorCallback) => {
        failure({
          code: 1,
          message: "Test denial",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        })
      },
    })
  })

  let attemptedJoin = false
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/join") attemptedJoin = true
  })

  await page.goto("/")

  await page.getByRole("button", { name: "Enter Pulse", exact: true }).click()
  await expect(
    page.getByText("Location permission is required to place you on the map."),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Enter Pulse", exact: true }),
  ).toBeEnabled()
  expect(attemptedJoin).toBe(false)
})

test("a location timeout offers a retry rather than entering the globe", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      value: (_success: PositionCallback, failure: PositionErrorCallback) => {
        failure({
          code: 3,
          message: "Test timeout",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        })
      },
    })
  })

  await page.goto("/")

  const enter = page.getByRole("button", { name: "Enter Pulse", exact: true })
  await enter.click()
  await expect(
    page.getByText("Couldn't get your location. Please try again."),
  ).toBeVisible()
  await expect(enter).toBeEnabled()
  await enter.click()
  await expect(enter).toBeEnabled()
  await expect(
    page.getByRole("heading", { name: "Pulse", exact: true }),
  ).toBeVisible()
})

test("a failed join stays at the gate and a retry enters the globe", async ({
  pair,
}) => {
  const page = pair.alice
  const pageErrors: string[] = []

  page.on("pageerror", (error) => pageErrors.push(error.message))

  // Fail before a server write; the retry uses the real API and test database.
  await page.route(
    "**/api/join",
    (route) => route.fulfill({ status: 503, body: "Private server detail" }),
    { times: 1 },
  )
  await page.goto("/")

  const enter = page.getByRole("button", { name: "Enter Pulse", exact: true })
  await enter.click()
  await expect(
    page.getByText("Couldn't enter Pulse. Please try again."),
  ).toBeVisible()
  await expect(enter).toBeEnabled()
  await expect(
    page.getByRole("heading", { name: "Pulse", exact: true }),
  ).toBeVisible()

  await enter.click()
  await expect(page.getByTitle("You are here", { exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})
