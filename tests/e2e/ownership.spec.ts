import { test, expect } from "@playwright/test"
import type { SessionCredentials } from "../../lib/session"
import { randomUUID } from "node:crypto"

test("public dot IDs cannot authorize mailbox access, impersonation or departure", async ({
  request,
}) => {
  const sessions: SessionCredentials[] = []
  try {
    for (let participant = 0; participant < 2; participant++) {
      const response = await request.post("/api/join", {
        data: { lat: 14.5995, lng: 120.9842, id: sessions[0]?.id },
      })

      expect(response.status()).toBe(200)

      const { id, token } = (await response.json()) as SessionCredentials
      sessions.push({ id, token })
    }

    const [alice, bob] = sessions
    const connectionId = randomUUID()
    expect(bob.id).not.toBe(alice.id)
    expect(bob.token).not.toBe(alice.token)

    const signal = await request.post("/api/signal", {
      headers: { Authorization: `Bearer ${bob.token}` },
      data: { fromId: bob.id, toId: alice.id, type: "request", connectionId },
    })
    expect(signal.status()).toBe(200)

    const unauthorized = await request.get(`/api/poll?id=${alice.id}`)
    expect(unauthorized.status()).toBe(401)
    expect(await unauthorized.json()).toEqual({ error: "unauthorized" })

    const wrongOwner = await request.get(`/api/poll?id=${alice.id}`, {
      headers: { Authorization: `Bearer ${bob.token}` },
    })
    expect(wrongOwner.status()).toBe(401)

    const impersonation = await request.post("/api/signal", {
      headers: { Authorization: `Bearer ${bob.token}` },
      data: { fromId: alice.id, toId: bob.id, type: "end", connectionId },
    })
    expect(impersonation.status()).toBe(401)

    const recipientMailbox = await request.get(`/api/poll?id=${bob.id}`, {
      headers: { Authorization: `Bearer ${bob.token}` },
    })
    expect(recipientMailbox.status()).toBe(200)
    expect((await recipientMailbox.json()).signals).toEqual([])

    const departure = await request.post("/api/leave", {
      data: { id: alice.id, token: bob.token },
    })
    expect(departure.status()).toBe(401)

    // The owner's queued request survives both unauthorized polls and deletion.
    const mailbox = await request.get(`/api/poll?id=${alice.id}`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    })
    expect(mailbox.status()).toBe(200)

    const body = await mailbox.json()
    expect(body.signals).toMatchObject([
      { fromId: bob.id, toId: alice.id, type: "request" },
    ])
    expect(body.signals).toHaveLength(1)
    expect(body.peers).toHaveLength(1)
    expect(Object.keys(body.peers[0]).sort()).toEqual([
      "busy",
      "id",
      "lat",
      "lng",
      "status",
    ])
  } finally {
    for (const credentials of sessions) {
      const response = await request.post("/api/leave", { data: credentials })
      expect(response.status()).toBe(200)
    }
  }
})
