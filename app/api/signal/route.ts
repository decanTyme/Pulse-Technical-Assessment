import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import type { SignalType } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
]

const MAX_PAYLOAD = 64 * 1024 // SDP/ICE are small; cap to be safe.

// POST /api/signal — body { fromId, toId, type, payload? }
// Drops one message into the recipient's mailbox. Tracks `busy` flags used
// to auto-decline additional requests during an active conversation.
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const { fromId, toId, type, payload } = (body ?? {}) as Record<
    string,
    unknown
  >

  if (typeof fromId !== "string" || typeof toId !== "string") {
    return Response.json({ error: "invalid ids" }, { status: 400 })
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 })
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 })
  }

  const signalType = type as SignalType
  const payloadStr = typeof payload === "string" ? payload : null

  const data = { fromId, toId, type: signalType, payload: payloadStr }
  try {
    if (signalType === "request") {
      const target = await prisma.presence.findUnique({
        where: { id: toId },
        select: { busy: true },
      })

      if (!target || target.busy) {
        await sendDecline(toId, fromId)
        return Response.json({ ok: true, autoDeclined: true })
      }
    }

    if (signalType === "accept" || signalType === "end") {
      // A failed mailbox write must also roll back the busy transition.
      await prisma.$transaction(async (tx) => {
        if (signalType === "end") {
          // Remove obsolete negotiation messages before the next attempt.
          await tx.signal.deleteMany({
            where: {
              OR: [
                { fromId, toId },
                { fromId: toId, toId: fromId },
              ],
            },
          })
        }

        await tx.presence.updateMany({
          where: { id: { in: [fromId, toId] } },
          data: { busy: signalType === "accept" },
        })

        await tx.signal.create({ data })
      })
    } else {
      // Pending requests do not reserve peers. Declining one must not clear
      // the reservation of an unrelated, already active conversation.
      await prisma.signal.create({ data })
    }

    return Response.json({ ok: true })
  } catch {
    // Do not expose database details or SDP/ICE payloads in the response.
    console.error("Signal coordination failed.")

    return Response.json({ error: "coordination unavailable" }, { status: 503 })
  }
}

// Helper: deliver an auto-decline from `target` back to `initiator`.
async function sendDecline(targetId: string, initiatorId: string) {
  await prisma.signal.create({
    data: {
      fromId: targetId,
      toId: initiatorId,
      type: "decline",
      payload: null,
    },
  })
}
