import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence"
import type { PollResponse } from "@/lib/types"
import { readSessionToken, verifySessionOwner } from "@/lib/session"
import {
  expirePendingConnections,
  removeSessions,
  runCoordinationTransaction,
} from "@/lib/coordination"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/poll?id= — the single endpoint that drives the live map.
// It (1) heartbeats the caller, (2) reaps stale presence + orphan signals,
// (3) returns the filtered online peers, and (4) drains this user's mailbox.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const id = params.get("id")

  if (!id) {
    return Response.json({ error: "missing id" }, { status: 400 })
  }

  const isOwner = await verifySessionOwner(id, readSessionToken(request))
  if (!isOwner) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const now = Date.now()
  const staleCutoff = new Date(now - STALE_MS)
  const signalCutoff = new Date(now - SIGNAL_TTL_MS)

  // Keep heartbeats and public map reads outside serializable pair transitions.
  await prisma.presence.updateMany({
    where: { id },
    data: { lastSeen: new Date(now) },
  })

  await runCoordinationTransaction(async (tx) => {
    // Partner release and participant removal must succeed together.
    await removeSessions(tx, { lastSeen: { lt: staleCutoff } })
    await expirePendingConnections(tx)
  })
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } })

  const peers = await prisma.presence.findMany({
    where: { id: { not: id }, lastSeen: { gte: staleCutoff } },
    select: { id: true, lat: true, lng: true, busy: true, status: true },
  })

  // Drain only this mailbox atomically, including concurrent owner polls.
  const inbox = await runCoordinationTransaction(async (tx) => {
    const inbox = await tx.signal.findMany({
      where: { toId: id },
      orderBy: { createdAt: "asc" },
    })
    if (inbox.length > 0) {
      await tx.signal.deleteMany({
        where: { id: { in: inbox.map((s) => s.id) } },
      })
    }

    return inbox
  })

  const response: PollResponse = {
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
      status: p.status,
    })),
    signals: inbox.flatMap((s) =>
      s.connectionId
        ? [
            {
              id: s.id,
              fromId: s.fromId,
              toId: s.toId,
              connectionId: s.connectionId,
              type: s.type as PollResponse["signals"][number]["type"],
              payload: s.payload,
              createdAt: s.createdAt.toISOString(),
            },
          ]
        : [],
    ),
  }

  return Response.json(response, { headers: { "Cache-Control": "no-store" } })
}
