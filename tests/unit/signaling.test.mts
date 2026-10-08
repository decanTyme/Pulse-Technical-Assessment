import assert from "node:assert/strict"
import test from "node:test"
import type { NextRequest } from "next/server"
import type { SignalType } from "../../lib/types.ts"
import { z } from "zod"

import { loadSource } from "../helpers/source.mts"
import { database } from "../helpers/database.mts"
import { createSessionHeaders, loadSessionModule } from "../helpers/session.mts"

type RequestModule = typeof import("../../lib/request.ts")
type SignalRouteModule = typeof import("../../app/api/signal/route.ts")

const { readJsonBody } = loadSource<RequestModule>("lib/request.ts")

const signalRequest = (type: SignalType, fromId = "alice", toId = "bob") =>
  ({
    headers: createSessionHeaders(fromId),
    json: async () => ({ type, fromId, toId }),
  }) as NextRequest

const loadSignalHandler = (prisma: unknown) =>
  loadSource<SignalRouteModule>("app/api/signal/route.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/session": loadSessionModule(prisma),
    "@/lib/request": { readJsonBody },
    zod: { z },
  }).POST

test("failed acceptance rolls back busy flags and a later acceptance succeeds", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)

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
  const POST = loadSignalHandler(db.prisma)
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
  const POST = loadSignalHandler(db.prisma)
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
  const POST = loadSignalHandler(db.prisma)
  await POST(signalRequest("accept"))
  await POST(signalRequest("decline", "bob", "charlie"))
  assert.equal(
    db.state.presence.every((row) => row.busy),
    true,
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
  const valid = { fromId: "alice", toId: "bob", type: "offer" }
  const cases: { body: unknown; error: string }[] = [
    { body: null, error: "invalid body" },
    { body: [], error: "invalid body" },
    { body: "unexpected", error: "invalid body" },
    { body: 123, error: "invalid body" },
    { body: { ...valid, fromId: undefined }, error: "invalid ids" },
    { body: { ...valid, fromId: 123 }, error: "invalid ids" },
    { body: { ...valid, toId: null }, error: "invalid ids" },
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
  const db = database()
  const POST = loadSignalHandler(db.prisma)
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
      const response = await POST({
        headers: createSessionHeaders(),
        json: async () => ({
          fromId: "alice",
          toId: "bob",
          type,
          payload,
          unexpected: true,
        }),
      } as NextRequest)

      assert.equal(response.status, 200)
      const signal = db.state.signal.at(-1)
      assert.ok(signal)
      assert.equal(signal.type, type)
      assert.equal(signal.payload, payload ?? null)
      assert.equal(Object.hasOwn(signal, "unexpected"), false)
    }
  }
})

test("payloads at the existing UTF-16 length boundary are preserved", async () => {
  const db = database()
  const POST = loadSignalHandler(db.prisma)

  for (const payload of ["x".repeat(64 * 1024), "😀".repeat(32 * 1024)]) {
    const response = await POST({
      headers: createSessionHeaders(),
      json: async () => ({
        fromId: "alice",
        toId: "bob",
        type: "ice",
        payload,
      }),
    } as NextRequest)

    assert.equal(response.status, 200)
    assert.equal(db.state.signal.at(-1)?.payload, payload)
  }
})
