import type { NextRequest } from "next/server"
import { z } from "zod"
import { readJsonBody } from "@/lib/request"
import type { SignalType } from "@/lib/types"
import { readSessionToken, verifySessionOwner } from "@/lib/session"
import { coordinateSignal, CoordinationConflict } from "@/lib/coordination"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_PAYLOAD = 64 * 1024 // Serialized payload length in UTF-16 code units.

const SignalBodySchema = z.object(
  {
    fromId: z.string({ error: "invalid ids" }),
    toId: z.string({ error: "invalid ids" }),
    connectionId: z.uuid({ error: "invalid connection id" }),
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

// POST /api/signal — body { fromId, toId, connectionId, type, payload? }
// Authorizes the connection transition before writing its mailbox message.
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
  const { fromId, toId } = data
  try {
    const isOwner = await verifySessionOwner(fromId, readSessionToken(request))
    if (!isOwner) {
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }

    if (fromId === toId) {
      return Response.json({ error: "invalid ids" }, { status: 400 })
    }

    const outcome = await coordinateSignal(data)
    return Response.json({ ok: true, ...outcome })
  } catch (error) {
    if (error instanceof CoordinationConflict) {
      return Response.json({ error: error.message }, { status: 409 })
    }

    // Do not expose database details or SDP/ICE payloads in the response.
    console.error("Signal coordination failed.")

    return Response.json({ error: "coordination unavailable" }, { status: 503 })
  }
}
