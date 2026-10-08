import { Prisma, type Presence } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { REQUEST_TIMEOUT_MS, STALE_MS } from "@/lib/presence"
import type { SignalData } from "@/lib/types"

type CoordinationOperation<Result> = (
  tx: Prisma.TransactionClient,
) => Promise<Result>

interface CoordinationResult {
  autoDeclined?: true
}

const CLEAR_CONNECTION = {
  busy: false,
  connectionId: null,
  peerId: null,
  initiatorId: null,
  requestedAt: null,
} satisfies Prisma.PresenceUpdateManyMutationInput

export class CoordinationConflict extends Error {
  constructor() {
    super("invalid connection state")
  }
}

export async function runCoordinationTransaction<Result>(
  operation: CoordinationOperation<Result>,
): Promise<Result> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (error) {
      // P2034 means this transaction rolled back. Transport failures have an
      // uncertain commit outcome and must never trigger an automatic write retry.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt >= 2
      ) {
        throw error
      }
    }
  }
}

async function closeConnection(
  tx: Prisma.TransactionClient,
  member: Presence,
  notifyPeer: boolean,
): Promise<boolean> {
  const { id, peerId, connectionId } = member
  if (!peerId || !connectionId) return false

  const changed = await tx.presence.updateMany({
    where: {
      connectionId,
      OR: [
        { id, peerId },
        { id: peerId, peerId: id },
      ],
    },
    data: CLEAR_CONNECTION,
  })

  if (changed.count === 0) return false

  // Scope cleanup to this pair and attempt; a late end cannot erase a newer one.
  await tx.signal.deleteMany({
    where: {
      connectionId,
      OR: [
        { fromId: id, toId: peerId },
        { fromId: peerId, toId: id },
      ],
    },
  })

  if (notifyPeer) {
    await tx.signal.create({
      data: {
        fromId: id,
        toId: peerId,
        connectionId,
        type: "end",
        payload: null,
      },
    })
  }

  return true
}

export async function expirePendingConnections(
  tx: Prisma.TransactionClient,
  participantIds?: string[],
): Promise<void> {
  const expired = await tx.presence.findMany({
    where: {
      ...(participantIds ? { id: { in: participantIds } } : {}),
      busy: false,
      connectionId: { not: null },
      requestedAt: { lt: new Date(Date.now() - REQUEST_TIMEOUT_MS) },
    },
  })

  for (const member of expired) {
    const { id, peerId, connectionId } = member
    const closed = await closeConnection(tx, member, true)

    if (closed && peerId && connectionId) {
      // Both screens need expiry feedback, including a paused initiator timer.
      await tx.signal.create({
        data: {
          fromId: peerId,
          toId: id,
          connectionId,
          type: "end",
          payload: null,
        },
      })
    }
  }
}

export async function removeSessions(
  tx: Prisma.TransactionClient,
  where: Prisma.PresenceWhereInput,
): Promise<void> {
  const departing = await tx.presence.findMany({ where })
  if (departing.length === 0) return
  const ids = departing.map((member) => member.id)

  await tx.signal.deleteMany({
    where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
  })

  for (const member of departing) {
    await closeConnection(tx, member, true)
  }

  await tx.presence.deleteMany({ where })
}

export async function coordinateSignal(
  data: SignalData,
): Promise<CoordinationResult> {
  const { fromId, toId, connectionId, type } = data

  return runCoordinationTransaction(async (tx) => {
    await expirePendingConnections(tx, [fromId, toId])
    const members = await tx.presence.findMany({
      where: { id: { in: [fromId, toId] } },
    })
    const sender = members.find((member) => member.id === fromId)
    const recipient = members.find((member) => member.id === toId)

    if (type === "request") {
      const cutoff = Date.now() - STALE_MS
      const available = [sender, recipient].every(
        (member) =>
          member &&
          !member.busy &&
          !member.connectionId &&
          member.lastSeen.getTime() >= cutoff,
      )

      if (!available) {
        await tx.signal.create({
          data: {
            fromId: toId,
            toId: fromId,
            connectionId,
            type: "decline",
            payload: null,
          },
        })

        return { autoDeclined: true }
      }

      const requestedAt = new Date()
      for (const member of members) {
        await tx.presence.updateMany({
          where: { id: member.id },
          data: {
            connectionId,
            peerId: member.id === fromId ? toId : fromId,
            initiatorId: fromId,
            requestedAt,
          },
        })
      }

      await tx.signal.create({ data })

      return {}
    }

    const matchesPair =
      sender?.connectionId === connectionId &&
      sender.peerId === toId &&
      recipient?.connectionId === connectionId &&
      recipient.peerId === fromId &&
      sender.initiatorId === recipient.initiatorId

    if (type === "end") {
      // End is idempotent even after a lost acknowledgement or peer departure.
      if (matchesPair) await closeConnection(tx, sender!, true)
      return {}
    }

    if (!matchesPair || !sender || !recipient) throw new CoordinationConflict()

    if (type === "accept" || type === "decline") {
      if (sender.busy || recipient.busy || sender.initiatorId !== toId) {
        throw new CoordinationConflict()
      }

      if (type === "decline") {
        await closeConnection(tx, sender, false)
      } else {
        const cutoff = new Date(Date.now() - STALE_MS)
        const reserved = await tx.presence.updateMany({
          where: {
            id: { in: [fromId, toId] },
            connectionId,
            busy: false,
            lastSeen: { gte: cutoff },
          },
          data: { busy: true },
        })

        if (reserved.count !== 2) throw new CoordinationConflict()
      }
    } else if (!sender.busy || !recipient.busy) {
      // SDP/ICE is allowed only after the intended recipient accepted this pair.
      throw new CoordinationConflict()
    }

    await tx.signal.create({ data })

    return {}
  })
}
