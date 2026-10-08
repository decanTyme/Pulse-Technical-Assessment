import assert from "node:assert/strict"
import test from "node:test"
import type { NextRequest } from "next/server"
import type { SignalType } from "../../lib/types.ts"
import { z } from "zod"

import { loadSource } from "../helpers/source.mts"
import { database } from "../helpers/database.mts"
import { createSessionHeaders, loadSessionModule } from "../helpers/session.mts"
import {
  CONNECTION_ID,
  NEXT_CONNECTION_ID,
  loadCoordinationModule,
} from "../helpers/coordination.mts"

type RequestModule = typeof import("../../lib/request.ts")
type SignalRouteModule = typeof import("../../app/api/signal/route.ts")
type SignalHandler = SignalRouteModule["POST"]

const { readJsonBody } = loadSource<RequestModule>("lib/request.ts")

const createSignalRequest = (
  type: SignalType,
  fromId = "alice",
  toId = "bob",
  connectionId = CONNECTION_ID,
) =>
  ({
    headers: createSessionHeaders(fromId),
    json: async () => ({ type, fromId, toId, connectionId }),
  }) as NextRequest

const loadSignalHandler = (prisma: unknown) =>
  loadSource<SignalRouteModule>("app/api/signal/route.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/session": loadSessionModule(prisma),
    "@/lib/request": { readJsonBody },
    "@/lib/coordination": loadCoordinationModule(prisma),
    zod: { z },
  }).POST

async function startActiveConnection(
  POST: SignalHandler,
  connectionId = CONNECTION_ID,
) {
  assert.equal(
    (await POST(createSignalRequest("request", "alice", "bob", connectionId)))
      .status,
    200,
  )
  assert.equal(
    (await POST(createSignalRequest("accept", "bob", "alice", connectionId)))
      .status,
    200,
  )
}

test("acceptance requires a pending request from the other participant", async () => {
  const db = database()
  const before = structuredClone(db.state)
  const POST = loadSignalHandler(db.prisma)

  const response = await POST(createSignalRequest("accept", "bob", "alice"))

  assert.equal(response.status, 409)
  assert.deepEqual(db.state, before)
})

test("failed acceptance rolls back busy flags and a later acceptance succeeds", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)

  assert.equal((await POST(createSignalRequest("request"))).status, 200)
  const before = structuredClone(db.state)
  db.failNext("accept")
  assert.equal(
    (await POST(createSignalRequest("accept", "bob", "alice"))).status,
    503,
  )
  assert.deepEqual(db.state, before)
  assert.equal(
    (await POST(createSignalRequest("accept", "bob", "alice"))).status,
    200,
  )
  assert.equal(
    db.state.presence.every((row) => row.busy),
    true,
  )
  assert.equal(db.state.signal.at(-1)?.type, "accept")
})

test("end clears reservations and obsolete negotiation so a second request is delivered", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)
  await startActiveConnection(POST)
  await POST(createSignalRequest("ice"))
  await POST(createSignalRequest("offer", "bob", "alice"))
  await POST(createSignalRequest("end"))
  assert.equal(
    db.state.presence.some((row) => row.busy),
    false,
  )
  assert.deepEqual(
    db.state.signal.map((row) => row.type),
    ["end"],
  )
  const result = await POST(
    createSignalRequest("request", "alice", "bob", NEXT_CONNECTION_ID),
  )
  assert.equal((await result.json()).autoDeclined, undefined)
  assert.equal(db.state.signal.at(-1)?.type, "request")
})

test("failed end rolls back cleanup and can be retried", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)
  await startActiveConnection(POST)
  const before = structuredClone(db.state)
  db.failNext("end")
  assert.equal((await POST(createSignalRequest("end"))).status, 503)
  assert.deepEqual(db.state, before)
  assert.equal((await POST(createSignalRequest("end"))).status, 200)
  assert.equal(
    db.state.presence.some((row) => row.busy),
    false,
  )
})

test("a third participant cannot end, accept or negotiate someone else's connection", async () => {
  const db = database(["alice", "bob", "charlie"])
  const POST = loadSignalHandler(db.prisma)
  await startActiveConnection(POST)
  const before = structuredClone(db.state)
  assert.equal(
    (await POST(createSignalRequest("end", "charlie", "bob"))).status,
    200,
  )
  for (const type of [
    "accept",
    "decline",
    "offer",
    "answer",
    "ice",
  ] satisfies SignalType[]) {
    assert.equal(
      (await POST(createSignalRequest(type, "charlie", "bob"))).status,
      409,
    )
  }
  assert.deepEqual(db.state, before)
  assert.equal((await POST(createSignalRequest("ice"))).status, 200)
})

test("pending requests cannot negotiate or accept themselves", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)
  assert.equal((await POST(createSignalRequest("request"))).status, 200)
  const before = structuredClone(db.state)
  for (const type of [
    "accept",
    "offer",
    "answer",
    "ice",
  ] satisfies SignalType[]) {
    assert.equal((await POST(createSignalRequest(type))).status, 409)
  }
  assert.deepEqual(db.state, before)
})

test("late signals from an ended attempt cannot change its replacement", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)
  await startActiveConnection(POST)
  assert.equal((await POST(createSignalRequest("end"))).status, 200)
  await startActiveConnection(POST, NEXT_CONNECTION_ID)
  const before = structuredClone(db.state)
  assert.equal((await POST(createSignalRequest("end"))).status, 200)
  for (const type of [
    "accept",
    "decline",
    "offer",
    "answer",
    "ice",
  ] satisfies SignalType[]) {
    assert.equal(
      (await POST(createSignalRequest(type, "bob", "alice"))).status,
      409,
    )
  }
  assert.deepEqual(db.state, before)
  assert.equal(
    (await POST(createSignalRequest("ice", "alice", "bob", NEXT_CONNECTION_ID)))
      .status,
    200,
  )
})

test("a pending request expires even while both participants remain online", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.now() })
  const db = database()
  const POST = loadSignalHandler(db.prisma)
  assert.equal((await POST(createSignalRequest("request"))).status, 200)
  context.mock.timers.tick(30_001)
  // Fresh heartbeats distinguish request expiry from an abandoned participant.
  for (const member of db.state.presence) member.lastSeen = new Date()
  assert.equal(
    (await POST(createSignalRequest("accept", "bob", "alice"))).status,
    409,
  )
  const retry = await POST(
    createSignalRequest("request", "alice", "bob", NEXT_CONNECTION_ID),
  )
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).autoDeclined, undefined)
  assert.deepEqual(
    db.state.signal
      .filter(
        (signal) =>
          signal.type === "end" && signal.connectionId === CONNECTION_ID,
      )
      .map((signal) => signal.toId)
      .sort(),
    ["alice", "bob"],
  )
  assert.equal(
    (
      await POST(
        createSignalRequest("accept", "bob", "alice", NEXT_CONNECTION_ID),
      )
    ).status,
    200,
  )
})

test("malformed JSON returns a fixed 400 error before database access", async () => {
  // No database methods: reaching coordination would return 503 or throw.
  const POST = loadSignalHandler({})
  const response = await POST({
    json: async (): Promise<unknown> => {
      throw new SyntaxError("Private submitted content")
    },
  } as NextRequest)

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "invalid body" })
})

test("invalid signal bodies return fixed 400 errors before database access", async () => {
  const POST = loadSignalHandler({})
  const valid = {
    fromId: "alice",
    toId: "bob",
    type: "offer",
    connectionId: CONNECTION_ID,
  }
  const cases: { body: unknown; error: string }[] = [
    { body: null, error: "invalid body" },
    { body: [], error: "invalid body" },
    { body: "unexpected", error: "invalid body" },
    { body: 123, error: "invalid body" },
    { body: { ...valid, fromId: undefined }, error: "invalid ids" },
    { body: { ...valid, fromId: 123 }, error: "invalid ids" },
    { body: { ...valid, toId: null }, error: "invalid ids" },
    {
      body: { ...valid, connectionId: undefined },
      error: "invalid connection id",
    },
    {
      body: { ...valid, connectionId: "invalid" },
      error: "invalid connection id",
    },
    { body: { ...valid, type: undefined }, error: "invalid type" },
    { body: { ...valid, type: 123 }, error: "invalid type" },
    { body: { ...valid, type: "unknown" }, error: "invalid type" },
    { body: { ...valid, payload: 123 }, error: "invalid payload" },
    { body: { ...valid, payload: {} }, error: "invalid payload" },
    {
      body: { ...valid, payload: "x".repeat(64 * 1024 + 1) },
      error: "invalid payload",
    },
    {
      body: { ...valid, payload: "😀".repeat(32 * 1024 + 1) },
      error: "invalid payload",
    },
  ]

  for (const { body, error } of cases) {
    const response = await POST({ json: async () => body } as NextRequest)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error })
  }
})

test("supported signal types normalize absent payloads and ignore extra fields", async () => {
  const types: SignalType[] = [
    "request",
    "accept",
    "decline",
    "offer",
    "answer",
    "ice",
    "end",
  ]

  for (const payload of [undefined, null, "", '{"synthetic":true}']) {
    for (const type of types) {
      const db = database()
      const POST = loadSignalHandler(db.prisma)
      if (type !== "request") {
        assert.equal((await POST(createSignalRequest("request"))).status, 200)
      }
      if (!["request", "accept", "decline"].includes(type)) {
        assert.equal(
          (await POST(createSignalRequest("accept", "bob", "alice"))).status,
          200,
        )
      }
      const [fromId, toId] = ["accept", "decline"].includes(type)
        ? ["bob", "alice"]
        : ["alice", "bob"]
      const response = await POST({
        headers: createSessionHeaders(fromId),
        json: async () => ({
          fromId,
          toId,
          type,
          connectionId: CONNECTION_ID,
          payload,
          unexpected: true,
        }),
      } as NextRequest)

      assert.equal(response.status, 200)
      const signal = db.state.signal.at(-1)
      assert.ok(signal)
      assert.equal(signal.type, type)
      assert.equal(signal.payload, type === "end" ? null : (payload ?? null))
      assert.equal(Object.hasOwn(signal, "unexpected"), false)
    }
  }
})

test("payloads at the existing UTF-16 length boundary are preserved", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)
  await startActiveConnection(POST)

  for (const payload of ["x".repeat(64 * 1024), "😀".repeat(32 * 1024)]) {
    const response = await POST({
      headers: createSessionHeaders(),
      json: async () => ({
        fromId: "alice",
        toId: "bob",
        type: "ice",
        connectionId: CONNECTION_ID,
        payload,
      }),
    } as NextRequest)

    assert.equal(response.status, 200)
    assert.equal(db.state.signal.at(-1)?.payload, payload)
  }
})
