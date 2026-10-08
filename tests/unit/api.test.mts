import assert from "node:assert/strict"
import test from "node:test"

import { loadSource, settle } from "../helpers/source.mts"

type ApiModule = typeof import("../../lib/api.ts")
type TimeoutCallback = () => void

test("signaling rejects HTTP failures without exposing the response body", async () => {
  const api = loadSource<ApiModule>(
    "lib/api.ts",
    {},
    {
      fetch: async () =>
        new Response("private database detail", { status: 503 }),
    },
  )

  await assert.rejects(api.sendSignal("alice", "bob", "request"), {
    message: "Signal coordination failed.",
  })
})

test("signaling waits for a successful HTTP response before completing", async () => {
  const response = Promise.withResolvers<Response>()
  let fetchStarted = false
  let settled = false

  const api = loadSource<ApiModule>(
    "lib/api.ts",
    {},
    {
      fetch: () => {
        fetchStarted = true
        return response.promise
      },
    },
  )

  const operation = api.sendSignal("alice", "bob", "end")
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
    {},
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
      fetch: (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener("abort", () =>
            reject(new Error("Aborted")),
          )
        }),
    },
  )

  const operation = api.sendSignal("alice", "bob", "request")
  expire()

  await assert.rejects(operation, { message: "Aborted" })
  assert.equal(cleared, true)
})
