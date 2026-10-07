import assert from "node:assert/strict"
import test from "node:test"
import type { NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { loadSource } from "../helpers/source.mts"

const { readJsonBody } =
  loadSource<typeof import("../../lib/request.ts")>("lib/request.ts")

const loadJoinHandler = (
  prisma: unknown,
  applyPrivacyOffset: typeof import("../../lib/geo.ts").applyPrivacyOffset = () => {
    throw new Error("Invalid requests must not reach the privacy offset")
  },
) =>
  loadSource<typeof import("../../app/api/join/route.ts")>(
    "app/api/join/route.ts",
    {
      "@/lib/prisma": { prisma },
      "@/lib/geo": { applyPrivacyOffset },
      "@/lib/request": { readJsonBody },
      zod: { z },
    },
  ).POST

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

test("invalid join IDs and coordinates are rejected before offset or database access", async () => {
  const POST = loadJoinHandler({})
  const valid = { id: "synthetic-session", lat: 14.5, lng: 120.25 }
  const cases: { body: unknown; error: string }[] = [
    { body: null, error: "invalid body" },
    { body: [], error: "invalid body" },
    { body: "unexpected", error: "invalid body" },
    { body: { ...valid, id: undefined }, error: "invalid id" },
    { body: { ...valid, id: 123 }, error: "invalid id" },
    { body: { ...valid, id: "a".repeat(7) }, error: "invalid id" },
    { body: { ...valid, id: "a".repeat(65) }, error: "invalid id" },
    { body: { ...valid, id: "😀".repeat(3) }, error: "invalid id" },
    { body: { ...valid, id: "😀".repeat(33) }, error: "invalid id" },
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
  const writes: Prisma.PresenceUpsertArgs[] = []
  const inputs: [number, number][] = []
  const offset = { lat: 12.5, lng: 120.75 }

  const POST = loadJoinHandler(
    {
      presence: {
        upsert: async (args: Prisma.PresenceUpsertArgs) => writes.push(args),
      },
    },
    (lat, lng) => {
      inputs.push([lat, lng])
      return offset
    },
  )

  const cases = [
    { id: "a".repeat(8), lat: -90, lng: -180 },
    { id: "a".repeat(64), lat: 90, lng: 180 },
    { id: "😀".repeat(4), lat: 0, lng: 0 },
    { id: "😀".repeat(32), lat: 14.5, lng: 120.25 },
  ]

  for (const body of cases) {
    const response = await POST({
      json: async () => ({ ...body, unexpected: true }),
    } as NextRequest)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.deepEqual(inputs.at(-1), [body.lat, body.lng])

    const write = writes.at(-1)
    assert.ok(write)
    assert.equal(write.where.id, body.id)
    assert.equal(write.create.id, body.id)
    assert.equal(write.create.lat, offset.lat)
    assert.equal(write.create.lng, offset.lng)
    assert.equal(write.create.busy, false)
    assert.equal(write.update.lat, offset.lat)
    assert.equal(write.update.lng, offset.lng)
    assert.equal(Object.hasOwn(write.create, "unexpected"), false)
    assert.equal(Object.hasOwn(write.update, "unexpected"), false)
  }

  assert.equal(writes.length, cases.length)
})
