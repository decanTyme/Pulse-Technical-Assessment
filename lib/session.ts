import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { z } from "zod"
import { prisma } from "@/lib/prisma"

export interface SessionCredentials {
  id: string
  token: string
}

export const SessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export function createSessionCredentials(): SessionCredentials {
  return { id: randomUUID(), token: randomBytes(32).toString("base64url") }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function readSessionToken(request: Request): string | undefined {
  const header = request.headers.get("authorization")
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)
  return match?.[1]
}

export async function verifySessionOwner(
  id: string,
  token: unknown,
): Promise<boolean> {
  const result = SessionTokenSchema.safeParse(token)
  if (!result.success) return false

  const presence = await prisma.presence.findUnique({
    where: { id },
    select: { tokenHash: true },
  })

  // Public dot IDs are identifiers, never credentials. Legacy rows fail closed.
  const stored = presence?.tokenHash
  if (!stored || !/^[a-f0-9]{64}$/.test(stored)) return false

  return timingSafeEqual(
    Buffer.from(stored, "hex"),
    Buffer.from(hashSessionToken(result.data), "hex"),
  )
}
