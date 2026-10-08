import * as crypto from "node:crypto"
import { z } from "zod"
import { loadSource } from "./source.mts"

type SessionModule = typeof import("../../lib/session.ts")

export const SESSION_TOKENS: Record<string, string> = {
  alice: "a".repeat(43),
  bob: "b".repeat(43),
}

export function createSessionHeaders(id = "alice"): Headers {
  return new Headers({ Authorization: `Bearer ${SESSION_TOKENS[id]}` })
}

// Exercise real token parsing, hashing and comparison; only the database is fake.
export function loadSessionModule(prisma: unknown) {
  return loadSource<SessionModule>(
    "lib/session.ts",
    { "node:crypto": crypto, zod: { z }, "@/lib/prisma": { prisma } },
    { Buffer },
  )
}
