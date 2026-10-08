"use client"

import { useState } from "react"

interface EntryGateProps {
  onReady: (lat: number, lng: number) => Promise<void>
}

export default function EntryGate({ onReady }: EntryGateProps) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle")
  const [error, setError] = useState<string>("")

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error")
      setError("Your browser doesn't support location access.")
      return
    }

    setStatus("locating")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await onReady(pos.coords.latitude, pos.coords.longitude)
        } catch {
          setStatus("error")
          setError("Couldn't enter Pulse. Please try again.")
        }
      },
      (err) => {
        setStatus("error")
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is required to place you on the map."
            : "Couldn't get your location. Please try again.",
        )
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 bg-background p-6 text-foreground">
      <div className="text-center">
        <h1 className="type-wordmark">Pulse</h1>
        <p className="type-body mt-2 max-w-sm text-muted">
          A living globe of anonymous strangers. Drop onto the map and connect.
        </p>
      </div>

      <button
        onClick={enter}
        disabled={status === "locating"}
        className="pulse-button pulse-button-primary px-8"
      >
        {status === "locating" ? "Locating…" : "Enter Pulse"}
      </button>

      {status === "error" && (
        <p
          role="alert"
          className="type-status max-w-sm text-center text-danger"
        >
          {error}
        </p>
      )}

      <p className="max-w-sm text-center text-xs text-muted">
        No sign-up. Your dot is placed 1–3&nbsp;km from your real location.
        Nothing is stored — closing the tab ends everything.
      </p>
    </div>
  )
}
