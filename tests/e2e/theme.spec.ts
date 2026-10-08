import { expect, mockMapDownloads, test } from "./fixtures"

test("theme choice overrides the system, survives reload, and can follow the system again", async ({
  page,
  context,
}) => {
  await mockMapDownloads(context)
  await page.emulateMedia({ colorScheme: "dark" })
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.goto("/")

  const selector = page.getByRole("combobox", { name: "Color theme" })
  const root = page.locator("html")
  await expect(selector).toHaveValue("system")
  await expect(root).toHaveCSS("color-scheme", "dark")
  await expect(
    page.getByText("Loading the globe…", { exact: true }),
  ).toHaveCount(0)

  const lightMap = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/styles/v1/mapbox/light-v11",
  )
  await selector.selectOption("light")
  await expect(root).toHaveCSS("color-scheme", "light")
  await lightMap

  await page.reload()
  await expect(selector).toHaveValue("light")
  await expect(root).toHaveCSS("color-scheme", "light")
  await page.emulateMedia({ colorScheme: "light" })
  await expect(
    page.getByText("Loading the globe…", { exact: true }),
  ).toHaveCount(0)

  const darkMap = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/styles/v1/mapbox/dark-v11",
  )
  await selector.selectOption("dark")
  await expect(root).toHaveCSS("color-scheme", "dark")
  await darkMap
  await page.emulateMedia({ colorScheme: "dark" })
  await page.emulateMedia({ colorScheme: "light" })
  await expect(root).toHaveCSS("color-scheme", "dark")

  await selector.selectOption("system")
  await expect(root).toHaveCSS("color-scheme", "light")
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(root).toHaveCSS("color-scheme", "dark")
  await expect(selector).toHaveValue("system")
  await expect(page.locator(".mapboxgl-canvas")).toHaveCount(1)
  expect(pageErrors).toEqual([])
})
