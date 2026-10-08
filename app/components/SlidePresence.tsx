"use client"

import { useEffect, useState, type ReactNode } from "react"

export const SLIDE_DURATION_MS = 220

export function getSlideDurationMs() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : SLIDE_DURATION_MS
}

interface SlidePresenceProps {
  present: boolean
  variant?: "card" | "conversation" | "dialog"
  className?: string
  children: ReactNode
}

export default function SlidePresence({
  present,
  variant = "card",
  className = "",
  children,
}: SlidePresenceProps) {
  const [mounted, setMounted] = useState(present)

  useEffect(() => {
    if (present || !mounted) return

    const timeout = window.setTimeout(
      () => setMounted(false),
      getSlideDurationMs(),
    )
    return () => window.clearTimeout(timeout)
  }, [mounted, present])

  if (!present && !mounted) return null

  return (
    <div
      aria-hidden={!present}
      inert={!present}
      data-slide-presence={present ? "enter" : "exit"}
      data-slide-variant={variant}
      className={`pulse-slide pointer-events-none absolute inset-0 ${className}`}
    >
      {children}
    </div>
  )
}
