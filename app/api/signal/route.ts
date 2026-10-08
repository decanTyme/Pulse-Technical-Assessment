import type { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { readJsonBody } from "@/lib/request"
import type { SignalType } from "@/lib/types"
import { readSessionToken, verifySessionOwner } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_PAYLOAD = 64 * 1024 // Serialized payload length in UTF-16 code units.

const SignalBodySchema = z.object(
  {
    fromId: z.string({ error: "invalid ids" }),
    toId: z.string({ error: "invalid ids" }),
    type: z.enum(
      [
        "request",
        "accept",
        "decline",
        "offer",
        "answer",
        "ice",
        "end",
      ] satisfies SignalType[],
      { error: "invalid type" },
    ),
    payload: z
      .string({ error: "invalid payload" })
      // Preserve the existing cap; Zod's .max() counts Unicode code points.
      .refine((value) => value.length <= MAX_PAYLOAD, {
        error: "invalid payload",
      })
      .nullish()
      .transform((value) => value ?? null),
  },
  { error: "invalid body" },
)

// POST /api/signal — body { fromId, toId, type, payload? }
// Drops one message into the recipient's mailbox. Tracks `busy` flags used
// to auto-decline additional requests during an active conversation.
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request)
  if (!body.success) {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const result = SignalBodySchema.safeParse(body.data)
  if (!result.success) {
    // Schema messages are fixed strings; never return submitted SDP/ICE data.
    return Response.json(
      { error: result.error.issues[0].message },
      { status: 400 },
    )
  }

  const data = result.data
  const { fromId, toId, type: signalType } = data
  try {
    const isOwner = await verifySessionOwner(fromId, readSessionToken(request))
    if (!isOwner) {
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }

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
