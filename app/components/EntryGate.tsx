"use client"

import { useState } from "react"

interface EntryGateProps {
  onReady: (lat: number, lng: number) => Promise<void>
}

type EntryStatus = "idle" | "locating" | "joining" | "error"

export default function EntryGate({ onReady }: EntryGateProps) {
  const [status, setStatus] = useState<EntryStatus>("idle")
  const [error, setError] = useState<string>("")

  const isEntering = status === "locating" || status === "joining"

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error")
      setError("Your browser doesn't support location access.")
      return
    }

    setStatus("locating")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setStatus("joining")
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
    <div className="pulse-entry-overlay">
      <section
        aria-labelledby="welcome-heading"
        aria-busy={isEntering}
        className="pulse-welcome"
      >
        <h2 id="welcome-heading" className="type-hero">
          The world feels closer together.
        </h2>
        <p className="type-body mt-4 text-muted">
          Meet someone new across the globe. Start with a hello.
        </p>

        <button
          onClick={enter}
          disabled={isEntering}
          className="pulse-button pulse-button-primary mt-6 w-full"
        >
          {status === "locating"
            ? "Finding your location…"
            : status === "joining"
              ? "Entering Pulse…"
              : "Enter Pulse"}
        </button>

        {isEntering && (
          <p role="status" className="type-status mt-3 text-muted">
            {status === "locating"
              ? "Allow location access to place your dot."
              : "Getting your place on the globe ready."}
          </p>
        )}

        {status === "error" && (
          <p role="alert" className="type-status mt-3 text-danger">
            {error}
          </p>
        )}

        <p className="mt-5 text-sm leading-relaxed text-muted">
          No sign-up. Your dot is offset by about 1–3&nbsp;km. Chat and video
          travel directly between participants.
        </p>
        <details className="mt-3 text-sm leading-relaxed text-muted">
          <summary className="w-fit cursor-pointer rounded-sm">
            Your location and privacy
          </summary>
          <p className="mt-2">
            We store approximate locations and connection details to coordinate
            sessions. Your browser sends its original location to our server,
            and Mapbox supplies the map. Peer connections may reveal network
            addresses. Closing the tab requests cleanup; if that request is
            lost, inactive data is removed during later activity.
          </p>
        </details>
      </section>
    </div>
  )
}
