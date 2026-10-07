import assert from "node:assert/strict"
import test from "node:test"
import { loadSource } from "../helpers/source.mts"

const { readJsonBody } =
  loadSource<typeof import("../../lib/request.ts")>("lib/request.ts")

test("JSON body reading preserves parsed values, including valid null", async () => {
  for (const data of [{ id: "synthetic" }, null]) {
    const request = new Request("http://localhost/api/signal", {
      method: "POST",
      body: JSON.stringify(data),
    })

    const result = await readJsonBody(request)
    assert.equal(result.success, true)
    assert.ok(result.success)
    assert.deepEqual(result.data, data)
  }
})

test("malformed, empty, and consumed request bodies return a safe failure", async () => {
  const requests = [
    new Request("http://localhost/api/signal", { method: "POST", body: "{" }),
    new Request("http://localhost/api/signal", { method: "POST" }),
    new Request("http://localhost/api/signal", { method: "POST", body: "{}" }),
  ]
  await requests[2].text()

  for (const request of requests) {
    const result = await readJsonBody(request)
    assert.equal(result.success, false)
    assert.deepEqual(Object.keys(result), ["success"])
  }
})
