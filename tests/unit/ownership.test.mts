import assert from "node:assert/strict"
import test from "node:test"
import type { NextRequest } from "next/server"
import { loadSource } from "../helpers/source.mts"
import { database } from "../helpers/database.mts"
import {
  CONNECTION_ID,
  loadCoordinationModule,
} from "../helpers/coordination.mts"
import { z } from "zod"
import {
  createSessionHeaders,
  loadSessionModule,
  SESSION_TOKENS,
} from "../helpers/session.mts"

type PollRouteModule = typeof import("../../app/api/poll/route.ts")
type SignalRouteModule = typeof import("../../app/api/signal/route.ts")
type LeaveRouteModule = typeof import("../../app/api/leave/route.ts")
type RequestModule = typeof import("../../lib/request.ts")
type Database = ReturnType<typeof database>

const { readJsonBody } = loadSource<RequestModule>("lib/request.ts")

function loadOwnedRoutes(db: Database) {
  const dependencies = {
    "@/lib/prisma": { prisma: db.prisma },
    "@/lib/coordination": loadCoordinationModule(db.prisma),
    "@/lib/session": loadSessionModule(db.prisma),
    "@/lib/request": { readJsonBody },
    "@/lib/presence": { STALE_MS: 15_000, SIGNAL_TTL_MS: 60_000 },
    zod: { z },
  }

  return {
    poll: loadSource<PollRouteModule>("app/api/poll/route.ts", dependencies)
      .GET,
    signal: loadSource<SignalRouteModule>(
      "app/api/signal/route.ts",
      dependencies,
    ).POST,
    leave: loadSource<LeaveRouteModule>("app/api/leave/route.ts", dependencies)
      .POST,
  }
}

function createPollRequest(id: string, headers = new Headers()): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/poll?id=${id}`),
    headers,
  } as NextRequest
}

function createLeaveRequest(id: string, token?: string): NextRequest {
  // Native JSON parsing must also work with sendBeacon's text/plain body.
  return new Request("http://localhost/api/leave", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ id, token }),
  }) as NextRequest
}

test("knowing a public session ID cannot read or consume its mailbox", async () => {
  const db = database()

  await db.prisma.signal.create({
    data: {
      fromId: "bob",
      toId: "alice",
      type: "request",
      connectionId: CONNECTION_ID,
    },
  })

  const before = structuredClone(db.state)
  const routes = loadOwnedRoutes(db)

  for (const headers of [
    new Headers(),
    createSessionHeaders("bob"),
    new Headers({ Authorization: "Bearer malformed" }),
  ]) {
    const response = await routes.poll(createPollRequest("alice", headers))
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: "unauthorized" })
  }

  assert.deepEqual(db.state, before)
})

test("the owner can consume its mailbox without exposing any credential", async () => {
  const db = database()

  await db.prisma.signal.create({
    data: {
      fromId: "bob",
      toId: "alice",
      type: "request",
      connectionId: CONNECTION_ID,
    },
  })

  const response = await loadOwnedRoutes(db).poll(
    createPollRequest("alice", createSessionHeaders()),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")

  const data = await response.json()
  assert.deepEqual(data.peers, [
    { id: "bob", lat: 1, lng: 2, busy: false, status: null },
  ])
  assert.equal(data.signals[0].type, "request")
  assert.equal(db.state.signal.length, 0)
})

test("another session's token cannot send signals on behalf of a public ID", async () => {
  const db = database()
  const before = structuredClone(db.state)
  const routes = loadOwnedRoutes(db)

  for (const type of ["request", "accept", "offer", "end"]) {
    for (const headers of [new Headers(), createSessionHeaders("bob")]) {
      const response = await routes.signal({
        headers,
        json: async () => ({
          fromId: "alice",
          toId: "bob",
          type,
          connectionId: CONNECTION_ID,
        }),
      } as NextRequest)
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: "unauthorized" })
    }
  }

  assert.deepEqual(db.state, before)
})

test("departure requires the departing session's token even for a beacon", async () => {
  const db = database()

  await db.prisma.signal.create({
    data: {
      fromId: "bob",
      toId: "alice",
      type: "request",
      connectionId: CONNECTION_ID,
    },
  })

  const before = structuredClone(db.state)
  const routes = loadOwnedRoutes(db)

  for (const token of [undefined, "malformed", SESSION_TOKENS.bob]) {
    const response = await routes.leave(createLeaveRequest("alice", token))
    assert.equal(response.status, 401)
    assert.deepEqual(db.state, before)
  }

  assert.equal(
    (await routes.leave(createLeaveRequest("alice", SESSION_TOKENS.alice)))
      .status,
    200,
  )
  assert.deepEqual(
    db.state.presence.map((row) => row.id),
    ["bob"],
  )
  assert.equal(db.state.signal.length, 0)
  assert.equal(
    (await routes.leave(createLeaveRequest("alice", SESSION_TOKENS.alice)))
      .status,
    401,
  )
})

test("legacy and absent sessions cannot authenticate", async () => {
  const db = database()
  db.state.presence[0].tokenHash = null

  const routes = loadOwnedRoutes(db)
  assert.equal(
    (await routes.poll(createPollRequest("alice", createSessionHeaders())))
      .status,
    401,
  )
  assert.equal(
    (await routes.poll(createPollRequest("absent", createSessionHeaders())))
      .status,
    401,
  )
})
