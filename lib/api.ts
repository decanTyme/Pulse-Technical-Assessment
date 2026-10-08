// Client-side helpers for talking to the coordination API.
import type { PollResponse, SignalType } from "@/lib/types"
import { z } from "zod"

type JoinResponse = z.infer<typeof JoinResponseSchema>

const SIGNAL_TIMEOUT_MS = 15_000
const JoinResponseSchema = z.object({
  ok: z.literal(true),
  id: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

// Each page keeps its private capability in memory, separate from public dot IDs.
let session: JoinResponse | undefined

function getSessionToken(id: string): string {
  if (!session || session.id !== id) {
    throw new Error("Session unavailable.")
  }

  return session.token
}

export async function join(lat: number, lng: number): Promise<string> {
  try {
    const response = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    })

    if (!response.ok) {
      throw new Error("Could not enter Pulse.")
    }

    const result = JoinResponseSchema.safeParse(await response.json())
    if (!result.success) {
      throw new Error("Could not enter Pulse.")
    }

    session = result.data
    return session.id
  } catch {
    throw new Error("Could not enter Pulse.")
  }
}

export async function poll(id: string): Promise<PollResponse> {
  const res = await fetch(`/api/poll?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${getSessionToken(id)}` },
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
  const token = getSessionToken(fromId)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS)

  try {
    const response = await fetch("/api/signal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
  const body = JSON.stringify({ id, token: getSessionToken(id) })
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
