"use client"

import { useSyncExternalStore } from "react"

type ThemePreference = "system" | "light" | "dark"

function getThemePreference(): ThemePreference {
  const preference = document.documentElement.dataset.themePreference
  return preference === "light" || preference === "dark" ? preference : "system"
}

function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement
  root.dataset.themePreference = preference
  root.dataset.theme =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference
  try {
    if (preference === "system") localStorage.removeItem("pulse-theme")
    else localStorage.setItem("pulse-theme", preference)
  } catch {
    // The choice still works for this page when browser storage is unavailable.
  }
}

function subscribeToTheme(onChange: () => void) {
  const system = window.matchMedia("(prefers-color-scheme: dark)")
  const updateSystemTheme = () => {
    if (getThemePreference() === "system") {
      document.documentElement.dataset.theme = system.matches ? "dark" : "light"
    }
  }
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-preference"],
  })
  system.addEventListener("change", updateSystemTheme)
  updateSystemTheme()
  return () => {
    observer.disconnect()
    system.removeEventListener("change", updateSystemTheme)
  }
}

export default function ThemeSelector() {
  const preference = useSyncExternalStore(
    subscribeToTheme,
    getThemePreference,
    () => "system",
  )

  return (
    <label>
      <span className="sr-only">Color theme</span>
      <select
        className="pulse-theme-select type-status"
        title="Color theme"
        value={preference}
        onChange={(event) => {
          const value = event.currentTarget.value
          if (value === "system" || value === "light" || value === "dark")
            applyThemePreference(value)
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}
