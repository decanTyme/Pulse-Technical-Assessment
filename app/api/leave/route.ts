import type { NextRequest } from "next/server"
import { z } from "zod"
import { readJsonBody } from "@/lib/request"
import { verifySessionOwner } from "@/lib/session"
import { removeSessions, runCoordinationTransaction } from "@/lib/coordination"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LeaveBodySchema = z.object({
  id: z.string().min(1),
  token: z.unknown().optional(),
})

// POST /api/leave — body { id, token }. Removes the presence row and any pending
// signals to/from this user. Called via navigator.sendBeacon on tab close, so
// the body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request)
  if (!body.success) {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const result = LeaveBodySchema.safeParse(body.data)
  if (!result.success) {
    return Response.json({ error: "invalid id" }, { status: 400 })
  }

  const { id, token } = result.data

  // sendBeacon cannot set Authorization, so departure carries its token in JSON.
  const isOwner = await verifySessionOwner(id, token)
  if (!isOwner) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  // Releasing the matching peer and removing the owner succeed or roll back together.
  await runCoordinationTransaction((tx) => removeSessions(tx, { id }))

  return Response.json({ ok: true })
}
