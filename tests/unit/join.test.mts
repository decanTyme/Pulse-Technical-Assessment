import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import type { NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { loadSource } from "../helpers/source.mts"
import { loadSessionModule } from "../helpers/session.mts"
import { database } from "../helpers/database.mts"

type RequestModule = typeof import("../../lib/request.ts")
type JoinRouteModule = typeof import("../../app/api/join/route.ts")
type ApplyPrivacyOffsetFunction =
  typeof import("../../lib/geo.ts").applyPrivacyOffset

const { readJsonBody } = loadSource<RequestModule>("lib/request.ts")

const loadJoinHandler = (
  prisma: unknown,
  applyPrivacyOffset: ApplyPrivacyOffsetFunction = () => {
    throw new Error("Invalid requests must not reach the privacy offset")
  },
) =>
  loadSource<JoinRouteModule>("app/api/join/route.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/session": loadSessionModule(prisma),
    "@/lib/geo": { applyPrivacyOffset },
    "@/lib/request": { readJsonBody },
    zod: { z },
  }).POST

test("malformed join JSON returns a fixed 400 before offset or database access", async () => {
  const POST = loadJoinHandler({})

  const response = await POST({
    json: async (): Promise<unknown> => {
      throw new SyntaxError("Private submitted content")
    },
  } as NextRequest)

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "invalid body" })
})

test("invalid join coordinates are rejected before offset or database access", async () => {
  const POST = loadJoinHandler({})

  const valid = { lat: 14.5, lng: 120.25 }
  const cases: { body: unknown; error: string }[] = [
    { body: null, error: "invalid body" },
    { body: [], error: "invalid body" },
    { body: "unexpected", error: "invalid body" },
    { body: { ...valid, lat: "14.5" }, error: "invalid coordinates" },
    { body: { ...valid, lat: null }, error: "invalid coordinates" },
    { body: { ...valid, lat: undefined }, error: "invalid coordinates" },
    { body: { ...valid, lat: NaN }, error: "invalid coordinates" },
    { body: { ...valid, lat: Infinity }, error: "invalid coordinates" },
    { body: { ...valid, lat: -90.01 }, error: "invalid coordinates" },
    { body: { ...valid, lat: 90.01 }, error: "invalid coordinates" },
    { body: { ...valid, lng: "120.25" }, error: "invalid coordinates" },
    { body: { ...valid, lng: -Infinity }, error: "invalid coordinates" },
    { body: { ...valid, lng: -180.01 }, error: "invalid coordinates" },
    { body: { ...valid, lng: 180.01 }, error: "invalid coordinates" },
  ]

  for (const { body, error } of cases) {
    const response = await POST({ json: async () => body } as NextRequest)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error })
  }
})

test("valid boundary joins persist offset coordinates and omit unused fields", async () => {
  const writes: Prisma.PresenceCreateArgs[] = []
  const inputs: [number, number][] = []
  const offset = { lat: 12.5, lng: 120.75 }

  const POST = loadJoinHandler(
    {
      presence: {
        create: async (args: Prisma.PresenceCreateArgs) => writes.push(args),
      },
    },
    (lat, lng) => {
      inputs.push([lat, lng])
      return offset
    },
  )

  const cases = [
    { lat: -90, lng: -180 },
    { lat: 90, lng: 180 },
    { lat: 0, lng: 0 },
  ]

  for (const body of cases) {
    const response = await POST({
      json: async () => ({ ...body, unexpected: true }),
    } as NextRequest)

    assert.equal(response.status, 200)

    const data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.match(data.id, /^[a-f0-9-]{36}$/)
    assert.match(data.token, /^[A-Za-z0-9_-]{43}$/)
    assert.deepEqual(inputs.at(-1), [body.lat, body.lng])

    const write = writes.at(-1)
    assert.ok(write)
    assert.equal(write.data.id, data.id)
    assert.equal(
      write.data.tokenHash,
      createHash("sha256").update(data.token).digest("hex"),
    )
    assert.equal(Object.hasOwn(write.data, "token"), false)
    assert.equal(write.data.lat, offset.lat)
    assert.equal(write.data.lng, offset.lng)
    assert.equal(write.data.busy, false)
    assert.equal(Object.hasOwn(write.data, "unexpected"), false)
  }

  assert.equal(writes.length, cases.length)
})

test("joining with another dot's ID creates distinct credentials and cannot overwrite it", async () => {
  const db = database()
  const existing = structuredClone(db.state.presence)

  const POST = loadJoinHandler(db.prisma, () => ({ lat: 12.5, lng: 120.75 }))

  const ids = new Set<string>()
  const tokens = new Set<string>()

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await POST({
      json: async () => ({ id: "alice", lat: 1, lng: 2 }),
    } as NextRequest)

    assert.equal(response.status, 200)

    const data = await response.json()
    assert.notEqual(data.id, "alice")

    ids.add(data.id)
    tokens.add(data.token)
    assert.equal(
      await loadSessionModule(db.prisma).verifySessionOwner(
        data.id,
        data.token,
      ),
      true,
    )
  }

  assert.equal(ids.size, 2)
  assert.equal(tokens.size, 2)
  assert.deepEqual(db.state.presence.slice(0, 2), existing)
})
