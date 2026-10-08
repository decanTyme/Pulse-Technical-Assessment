import type { Presence, Signal } from "@prisma/client"
import { createHash } from "node:crypto"
import { SESSION_TOKENS } from "./session.mts"

type ConnectionFields =
  "connectionId" | "peerId" | "initiatorId" | "requestedAt"
type CreatedPresence = Omit<Presence, ConnectionFields> &
  Partial<Pick<Presence, ConnectionFields>>
type CreatedSignal = Pick<Signal, "fromId" | "toId" | "type"> &
  Partial<Pick<Signal, "payload" | "connectionId">>

interface Where {
  id?: string | { in?: string[]; not?: string }
  fromId?: string | { in?: string[] }
  toId?: string | { in?: string[] }
  connectionId?: string | null | { not: null }
  peerId?: string | null
  initiatorId?: string | null
  busy?: boolean
  requestedAt?: { lt?: Date; gte?: Date }
  lastSeen?: { lt?: Date; gte?: Date }
  createdAt?: { lt?: Date }
  OR?: Where[]
}

interface State {
  presence: Presence[]
  signal: Signal[]
}

export function database(ids = ["alice", "bob"]) {
  let nextId = 0
  let failType: string | undefined
  let state: State = {
    presence: ids.map((id) => ({
      id,
      tokenHash: createHash("sha256").update(SESSION_TOKENS[id]).digest("hex"),
      lat: 1,
      lng: 2,
      busy: false,
      lastSeen: new Date(),
      connectionId: null,
      peerId: null,
      initiatorId: null,
      requestedAt: null,
    })),
    signal: [],
  }

  function matches(row: Presence | Signal, where: Where = {}): boolean {
    const entries = Object.entries(where) as [keyof Where, Where[keyof Where]][]

    return entries.every(([key, value]) => {
      if (Array.isArray(value)) return value.some((part) => matches(row, part))

      const actual: unknown = Reflect.get(row, key)
      if (value && typeof value === "object") {
        if ("in" in value)
          return typeof actual === "string" && !!value.in?.includes(actual)
        if ("not" in value) return actual !== value.not
        // Numeric dates also work across the VM's separate Date realm.
        if ("lt" in value) return Number(actual) < Number(value.lt)
        if ("gte" in value) return Number(actual) >= Number(value.gte)
      }

      return actual === value
    })
  }

  function models(getState: () => State) {
    const model = <Row extends Presence | Signal>(
      getRows: () => Row[],
      setRows: (rows: Row[]) => void,
    ) => ({
      async updateMany({ where, data }: { where: Where; data: Partial<Row> }) {
        const rows = getRows().filter((row) => matches(row, where))
        for (const row of rows) Object.assign(row, data)
        return { count: rows.length }
      },
      async deleteMany({ where }: { where: Where }) {
        setRows(getRows().filter((row) => !matches(row, where)))
      },
      async findUnique({ where }: { where: Where }) {
        return getRows().find((row) => matches(row, where)) ?? null
      },
      async findMany({ where }: { where: Where }) {
        return getRows().filter((row) => matches(row, where))
      },
    })

    return {
      presence: {
        ...model(
          () => getState().presence,
          (rows) => {
            getState().presence = rows
          },
        ),
        async create({ data }: { data: CreatedPresence }) {
          if (getState().presence.some((row) => row.id === data.id)) {
            throw new Error("Duplicate session")
          }

          const row = {
            connectionId: null,
            peerId: null,
            initiatorId: null,
            requestedAt: null,
            ...data,
          }
          getState().presence.push(row)

          return row
        },
      },
      signal: {
        ...model(
          () => getState().signal,
          (rows) => {
            getState().signal = rows
          },
        ),
        async create({ data }: { data: CreatedSignal }) {
          if (data.type === failType) {
            failType = undefined
            throw new Error("Injected transport failure")
          }

          const row: Signal = {
            id: String(nextId++),
            createdAt: new Date(),
            payload: null,
            connectionId: null,
            ...data,
          }

          getState().signal.push(row)

          return row
        },
      },
    }
  }

  const prisma = {
    ...models(() => state),
    async $transaction<Result>(
      callback: (tx: ReturnType<typeof models>) => Promise<Result>,
    ) {
      const draft = structuredClone(state)
      const result = await callback(models(() => draft))
      state = draft
      return result
    },
  }

  return {
    prisma,
    get state() {
      return state
    },
    failNext(type: string) {
      failType = type
    },
  }
}
