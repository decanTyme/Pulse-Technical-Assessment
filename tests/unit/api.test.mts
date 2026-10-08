import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"

import { loadSource, settle } from "../helpers/source.mts"
import { CONNECTION_ID } from "../helpers/coordination.mts"

type ApiModule = typeof import("../../lib/api.ts")
type TimeoutCallback = () => void

const SESSION_ID = "00000000-0000-4000-8000-000000000001"
const SESSION_TOKEN = "a".repeat(43)

function createJoinResponse() {
  return Response.json({ ok: true, id: SESSION_ID, token: SESSION_TOKEN })
}

test("failed joins return a fixed error without storing credentials", async () => {
  const failures = [
    async () => {
      throw new Error("Private network detail")
    },
    async () => new Response("Private server detail", { status: 503 }),
    async () => new Response("Private invalid JSON"),
    async () => Response.json({ ok: true, id: SESSION_ID }),
  ]

  for (const fail of failures) {
    const api = loadSource<ApiModule>(
      "lib/api.ts",
      { zod: { z } },
      { fetch: fail },
    )

    await assert.rejects(api.join(1, 2), { message: "Could not enter Pulse." })
    await assert.rejects(api.poll(SESSION_ID), {
      message: "Session unavailable.",
    })
  }
})

test("signaling rejects HTTP failures without exposing the response body", async () => {
  const api = loadSource<ApiModule>(
    "lib/api.ts",
    { zod: { z } },
    {
      fetch: async (url: string) =>
        url === "/api/join"
          ? createJoinResponse()
          : new Response("private database detail", { status: 503 }),
    },
  )

  await api.join(1, 2)
  await assert.rejects(
    api.sendSignal(SESSION_ID, "bob", "request", CONNECTION_ID),
    {
      message: "Signal coordination failed.",
    },
  )
})

test("signaling waits for a successful HTTP response before completing", async () => {
  const response = Promise.withResolvers<Response>()
  let fetchStarted = false
  let settled = false

  const api = loadSource<ApiModule>(
    "lib/api.ts",
    { zod: { z } },
    {
      fetch: (url: string) => {
        if (url === "/api/join") return Promise.resolve(createJoinResponse())
        fetchStarted = true
        return response.promise
      },
    },
  )

  await api.join(1, 2)
  const operation = api.sendSignal(SESSION_ID, "bob", "end", CONNECTION_ID)
  void operation.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )

  try {
    await settle()
    assert.equal(fetchStarted, true)
    assert.equal(settled, false)

    response.resolve(Response.json({ ok: true }))
    await assert.doesNotReject(operation)
    assert.equal(settled, true)
  } finally {
    // Release the fetch and its timeout even when a pending-state assertion fails.
    response.resolve(Response.json({ ok: true }))
    await operation.catch(() => {})
  }
})

test("signaling aborts a stalled fetch after 15 seconds and clears its timer", async () => {
  const timer = Symbol("signaling timeout")
  let expire!: TimeoutCallback
  let cleared = false

  const api = loadSource<ApiModule>(
    "lib/api.ts",
    { zod: { z } },
    {
      setTimeout(callback: TimeoutCallback, delay: number) {
        assert.equal(delay, 15_000)
        expire = callback
        return timer
      },
      clearTimeout(handle: symbol) {
        assert.equal(handle, timer)
        cleared = true
      },
      fetch: (url: string, options: RequestInit) =>
        url === "/api/join"
          ? Promise.resolve(createJoinResponse())
          : new Promise<Response>((_resolve, reject) => {
              options.signal!.addEventListener("abort", () =>
                reject(new Error("Aborted")),
              )
            }),
    },
  )

  await api.join(1, 2)
  const operation = api.sendSignal(SESSION_ID, "bob", "request", CONNECTION_ID)
  expire()

  await assert.rejects(operation, { message: "Aborted" })
  assert.equal(cleared, true)
})

test("the client sends private credentials in headers or the departure beacon, never URLs", async () => {
  const calls: { url: string; options: RequestInit }[] = []
  let beaconBody: string | undefined

  const api = loadSource<ApiModule>(
    "lib/api.ts",
    { zod: { z } },
    {
      fetch: async (url: string, options: RequestInit) => {
        calls.push({ url, options })
        return url === "/api/join"
          ? createJoinResponse()
          : Response.json({ peers: [], signals: [] })
      },
      navigator: {
        sendBeacon(url: string, body: string) {
          assert.equal(url, "/api/leave")
          beaconBody = body
          return true
        },
      },
    },
  )

  assert.equal(await api.join(1, 2), SESSION_ID)

  await api.poll(SESSION_ID)
  await api.sendSignal(SESSION_ID, "bob", "request", CONNECTION_ID)
  api.leave(SESSION_ID)

  assert.deepEqual(JSON.parse(calls[0].options.body as string), {
    lat: 1,
    lng: 2,
  })

  for (const call of calls.slice(1)) {
    assert.equal(
      new Headers(call.options.headers).get("authorization"),
      `Bearer ${SESSION_TOKEN}`,
    )
    assert.equal(call.url.includes(SESSION_TOKEN), false)
    assert.equal(
      call.options.body?.toString().includes(SESSION_TOKEN) ?? false,
      false,
    )
  }

  assert.deepEqual(JSON.parse(beaconBody!), {
    id: SESSION_ID,
    token: SESSION_TOKEN,
  })

  await assert.rejects(api.poll("bob"), { message: "Session unavailable." })
})
