// Client-side helpers for talking to the coordination API.
import type { PollResponse, SignalType } from "@/lib/types"

const SIGNAL_TIMEOUT_MS = 15_000

export async function join(
  id: string,
  lat: number,
  lng: number,
): Promise<void> {
  await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, lat, lng }),
  })
}

export async function poll(id: string): Promise<PollResponse> {
  const res = await fetch(`/api/poll?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  })

  if (!res.ok) {
    throw new Error(`poll failed: ${res.status}`)
  }

  return res.json()
}

export async function sendSignal(
  fromId: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS)

  try {
    const response = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId, toId, type, payload }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error("Signal coordination failed.")
    }
  } finally {
    clearTimeout(timer)
  }
}

// Fire-and-forget leave that survives the tab closing.
export function leave(id: string): void {
  const body = JSON.stringify({ id })
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body)
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    })
  }
}
