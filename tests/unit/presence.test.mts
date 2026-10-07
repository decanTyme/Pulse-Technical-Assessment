import assert from "node:assert/strict"
import test from "node:test"
import type { NextRequest } from "next/server"

import { loadSource } from "../helpers/source.mts"
import { database } from "../helpers/database.mts"

type PollRouteModule = typeof import("../../app/api/poll/route.ts")

test("poll refreshes its caller while removing an abandoned dot", async () => {
  const db = database()

  db.state.presence[1].lastSeen = new Date(Date.now() - 60_000)

  const { GET } = loadSource<PollRouteModule>("app/api/poll/route.ts", {
    "@/lib/prisma": { prisma: db.prisma },
    "@/lib/presence": { STALE_MS: 15_000, SIGNAL_TTL_MS: 60_000 },
  })

  const response = await GET({
    nextUrl: new URL("http://localhost/api/poll?id=alice"),
  } as NextRequest)

  assert.equal(response.status, 200)
  assert.deepEqual(
    db.state.presence.map((row) => row.id),
    ["alice"],
  )
  assert.deepEqual((await response.json()).peers, [])
})
