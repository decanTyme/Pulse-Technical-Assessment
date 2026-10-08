"use client"

import { useState } from "react"

interface EntryGateProps {
  onReady: (lat: number, lng: number, status: string) => Promise<void>
}

type EntryStatus = "idle" | "locating" | "joining" | "error"

export default function EntryGate({ onReady }: EntryGateProps) {
  const [status, setStatus] = useState<EntryStatus>("idle")
  const [error, setError] = useState<string>("")
  const [conversationStatus, setConversationStatus] = useState("")

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
          await onReady(
            pos.coords.latitude,
            pos.coords.longitude,
            conversationStatus.trim(),
          )
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
    <div
      className="
        pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pt-6
        pb-[max(4.5rem,calc(env(safe-area-inset-bottom)+2.5rem))] sm:px-6
      "
    >
      <section
        aria-labelledby="welcome-heading"
        aria-busy={isEntering}
        className="
          pointer-events-auto max-h-[calc(100dvh-9rem)] w-full max-w-[420px] overflow-y-auto
          overscroll-contain rounded-panel bg-surface p-6 shadow-[0_12px_48px_var(--shadow-warm)] sm:p-8
        "
      >
        <h2
          id="welcome-heading"
          className="font-heading font-semibold tracking-[-0.035em] [font-variation-settings:'SOFT'_50,'WONK'_0] text-[clamp(2rem,3.5vw,2.75rem)] leading-[1.08]"
        >
          The world feels closer together.
        </h2>
        <p className="mt-4 text-base leading-normal text-muted">
          Meet someone new across the globe. Start with a hello.
        </p>

        <label
          htmlFor="conversation-status"
          className="mt-5 block text-sm font-medium"
        >
          Your conversation starter{" "}
          <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="conversation-status"
          type="text"
          maxLength={60}
          disabled={isEntering}
          value={conversationStatus}
          onChange={(event) => setConversationStatus(event.target.value)}
          placeholder="Ask me about cats! 🐈"
          className="mt-2 w-full rounded-control border border-current/20 bg-surface-muted px-3 py-3 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        <p className="mt-1 text-right text-xs text-muted">
          {conversationStatus.length}/60
        </p>

        <button
          onClick={enter}
          disabled={isEntering}
          className="
            inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
            px-5 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
            duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
            bg-primary text-primary-foreground shadow-[0_4px_12px_var(--shadow-warm)]
            enabled:hover:bg-primary-hover enabled:hover:shadow-[0_5px_16px_var(--shadow-warm)] mt-6 w-full
          "
        >
          {status === "locating"
            ? "Finding your location…"
            : status === "joining"
              ? "Entering Pulse…"
              : "Enter Pulse"}
        </button>

        {isEntering && (
          <p
            role="status"
            className="text-sm font-medium leading-snug mt-3 text-muted"
          >
            {status === "locating"
              ? "Allow location access to place your dot."
              : "Getting your place on the globe ready."}
          </p>
        )}

        {status === "error" && (
          <p
            role="alert"
            className="text-sm font-medium leading-snug mt-3 text-danger"
          >
            {error}
          </p>
        )}

        <p className="mt-6 text-sm leading-relaxed text-muted">
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
