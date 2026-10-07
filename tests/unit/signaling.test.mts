import assert from "node:assert/strict"
import test from "node:test"
import type { NextRequest } from "next/server"
import type { SignalType } from "../../lib/types.ts"

import { loadSource } from "../helpers/source.mts"
import { database } from "../helpers/database.mts"

const signalRequest = (type: SignalType, fromId = "alice", toId = "bob") =>
  ({
    json: async () => ({ type, fromId, toId }),
  }) as NextRequest

test("failed acceptance rolls back busy flags and a later acceptance succeeds", async () => {
  const db = database()
  const { POST } = loadSource<typeof import("../../app/api/signal/route.ts")>(
    "app/api/signal/route.ts",
    { "@/lib/prisma": db },
  )
  db.failNext("accept")
  assert.equal((await POST(signalRequest("accept"))).status, 503)
  assert.equal(
    db.state.presence.some((row) => row.busy),
    false,
  )
  assert.equal(db.state.signal.length, 0)
  assert.equal((await POST(signalRequest("accept"))).status, 200)
  assert.equal(
    db.state.presence.every((row) => row.busy),
    true,
  )
  assert.equal(db.state.signal[0].type, "accept")
})

test("end clears reservations and obsolete negotiation so a second request is delivered", async () => {
  const db = database()
  const { POST } = loadSource<typeof import("../../app/api/signal/route.ts")>(
    "app/api/signal/route.ts",
    { "@/lib/prisma": db },
  )
  await POST(signalRequest("accept"))
  await POST(signalRequest("ice"))
  await POST(signalRequest("offer", "bob", "alice"))
  await POST(signalRequest("end"))
  assert.equal(
    db.state.presence.some((row) => row.busy),
    false,
  )
  assert.deepEqual(
    db.state.signal.map((row) => row.type),
    ["end"],
  )
  const result = await POST(signalRequest("request"))
  assert.equal((await result.json()).autoDeclined, undefined)
  assert.equal(db.state.signal.at(-1)?.type, "request")
})

test("failed end rolls back cleanup and can be retried", async () => {
  const db = database()
  const { POST } = loadSource<typeof import("../../app/api/signal/route.ts")>(
    "app/api/signal/route.ts",
    { "@/lib/prisma": db },
  )
  await POST(signalRequest("accept"))
  db.failNext("end")
  assert.equal((await POST(signalRequest("end"))).status, 503)
  assert.equal(
    db.state.presence.every((row) => row.busy),
    true,
  )
  assert.equal(db.state.signal[0].type, "accept")
  assert.equal((await POST(signalRequest("end"))).status, 200)
  assert.equal(
    db.state.presence.some((row) => row.busy),
    false,
  )
})

test("declining another request does not free an active conversation", async () => {
  const db = database()
  const { POST } = loadSource<typeof import("../../app/api/signal/route.ts")>(
    "app/api/signal/route.ts",
    { "@/lib/prisma": db },
  )
  await POST(signalRequest("accept"))
  await POST(signalRequest("decline", "bob", "charlie"))
  assert.equal(
    db.state.presence.every((row) => row.busy),
    true,
  )
})
