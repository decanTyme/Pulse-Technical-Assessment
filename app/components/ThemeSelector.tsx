"use client"

import { useSyncExternalStore } from "react"

type ThemePreference = "system" | "light" | "dark"

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
}

const THEME_LABELS = { system: "System", light: "Light", dark: "Dark" }

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

function cycleThemePreference() {
  applyThemePreference(NEXT_THEME[getThemePreference()])
}

export default function ThemeSelector() {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribeToTheme,
    getThemePreference,
    () => "system",
  )
  const label = `Color theme: ${THEME_LABELS[preference]}. Switch to ${THEME_LABELS[NEXT_THEME[preference]]}.`

  return (
    <button
      type="button"
      className="
        grid size-11 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-2.5
        text-foreground hover:bg-foreground/10 hover:text-primary focus-visible:bg-foreground/10
        focus-visible:text-primary
      "
      aria-label={label}
      title={label}
      onClick={cycleThemePreference}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {preference === "system" ? (
          <>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M12 16v4M8 20h8" />
          </>
        ) : preference === "light" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
          </>
        ) : (
          <path d="M20.9 13.35A9 9 0 0 1 10.65 3.1 9 9 0 1 0 20.9 13.35Z" />
        )}
      </svg>
    </button>
  )
}
