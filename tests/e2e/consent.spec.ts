import { randomUUID } from "node:crypto"
import { expect, test, type APIRequestContext } from "@playwright/test"
import type { SessionCredentials } from "../../lib/session"
import type { PollResponse, SignalType } from "../../lib/types"

async function joinParticipants(
  request: APIRequestContext,
  sessions: SessionCredentials[],
) {
  for (let participant = 0; participant < 3; participant++) {
    const response = await request.post("/api/join", {
      data: { lat: 14.5995, lng: 120.9842 },
    })
    expect(response.status()).toBe(200)
    const { id, token } = await response.json()
    sessions.push({ id, token })
  }
}

async function removeParticipants(
  request: APIRequestContext,
  sessions: SessionCredentials[],
) {
  for (const session of sessions) {
    const response = await request.post("/api/leave", { data: session })
    expect(response.status()).toBe(200)
  }
}

function postSignal(
  request: APIRequestContext,
  sender: SessionCredentials,
  recipient: SessionCredentials,
  type: SignalType,
  connectionId: string,
) {
  return request.post("/api/signal", {
    headers: { Authorization: `Bearer ${sender.token}` },
    data: { fromId: sender.id, toId: recipient.id, type, connectionId },
  })
}

async function pollParticipant(
  request: APIRequestContext,
  session: SessionCredentials,
): Promise<PollResponse> {
  const response = await request.get(`/api/poll?id=${session.id}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  })
  expect(response.status()).toBe(200)
  return response.json()
}

test("signals require recipient consent and cannot affect another pair or a newer attempt", async ({
  request,
}) => {
  const sessions: SessionCredentials[] = []
  try {
    await joinParticipants(request, sessions)
    const [alice, bob, charlie] = sessions
    const previous = randomUUID()
    const current = randomUUID()

    expect(
      (await postSignal(request, bob, alice, "accept", previous)).status(),
    ).toBe(409)
    expect(
      (await postSignal(request, alice, alice, "request", previous)).status(),
    ).toBe(400)
    expect(
      (await postSignal(request, alice, bob, "request", previous)).status(),
    ).toBe(200)
    expect(
      (await postSignal(request, alice, bob, "ice", previous)).status(),
    ).toBe(409)
    expect(
      (await postSignal(request, alice, bob, "accept", previous)).status(),
    ).toBe(409)
    expect(
      (await postSignal(request, bob, alice, "accept", previous)).status(),
    ).toBe(200)

    expect(
      (await postSignal(request, charlie, bob, "end", previous)).status(),
    ).toBe(200)
    expect(
      (await postSignal(request, charlie, bob, "offer", previous)).status(),
    ).toBe(409)
    expect(
      (await postSignal(request, alice, bob, "ice", previous)).status(),
    ).toBe(200)
    expect(
      (await postSignal(request, alice, bob, "end", previous)).status(),
    ).toBe(200)

    expect(
      (await postSignal(request, alice, bob, "request", current)).status(),
    ).toBe(200)
    expect(
      (await postSignal(request, bob, alice, "accept", current)).status(),
    ).toBe(200)
    expect(
      (await postSignal(request, alice, bob, "end", previous)).status(),
    ).toBe(200)
    expect(
      (await postSignal(request, bob, alice, "offer", previous)).status(),
    ).toBe(409)
    expect(
      (await postSignal(request, alice, bob, "ice", current)).status(),
    ).toBe(200)

    const mailbox = await pollParticipant(request, bob)
    expect(mailbox.peers.find((peer) => peer.id === alice.id)?.busy).toBe(true)
    expect(mailbox.peers.find((peer) => peer.id === charlie.id)?.busy).toBe(
      false,
    )
    expect(mailbox.signals.some((signal) => signal.fromId === charlie.id)).toBe(
      false,
    )
    expect(
      mailbox.signals
        .filter((signal) => signal.connectionId === current)
        .map((signal) => signal.type),
    ).toEqual(["request", "ice"])
  } finally {
    await removeParticipants(request, sessions)
  }
})

test("simultaneous requests and acceptances admit only one current pair", async ({
  request,
}) => {
  const sessions: SessionCredentials[] = []
  try {
    await joinParticipants(request, sessions)

    const [alice, bob, charlie] = sessions
    const attempts = [
      { peer: bob, connectionId: randomUUID() },
      { peer: charlie, connectionId: randomUUID() },
    ]

    const requests = await Promise.all(
      attempts.map((attempt) =>
        postSignal(
          request,
          alice,
          attempt.peer,
          "request",
          attempt.connectionId,
        ),
      ),
    )

    for (const response of requests) {
      expect(response.status()).toBe(200)
    }

    const outcomes = await Promise.all(
      requests.map((response) => response.json()),
    )
    const acceptedIndices = outcomes.flatMap((outcome, index) =>
      outcome.autoDeclined ? [] : [index],
    )
    expect(acceptedIndices).toHaveLength(1)

    const winner = attempts[acceptedIndices[0]]
    const loser = attempts[1 - acceptedIndices[0]]

    const acceptances = await Promise.all([
      postSignal(request, winner.peer, alice, "accept", winner.connectionId),
      postSignal(request, winner.peer, alice, "accept", winner.connectionId),
    ])
    expect(acceptances.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ])
    expect(
      (
        await postSignal(
          request,
          loser.peer,
          alice,
          "accept",
          loser.connectionId,
        )
      ).status(),
    ).toBe(409)

    const mailbox = await pollParticipant(request, alice)
    expect(mailbox.peers.find((peer) => peer.id === winner.peer.id)?.busy).toBe(
      true,
    )
    expect(mailbox.peers.find((peer) => peer.id === loser.peer.id)?.busy).toBe(
      false,
    )
    expect(
      mailbox.signals.filter((signal) => signal.type === "accept"),
    ).toMatchObject([
      { fromId: winner.peer.id, connectionId: winner.connectionId },
    ])
    expect(
      mailbox.signals.filter((signal) => signal.type === "accept"),
    ).toHaveLength(1)
  } finally {
    await removeParticipants(request, sessions)
  }
})
