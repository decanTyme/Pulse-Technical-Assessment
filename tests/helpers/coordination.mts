import { Prisma } from "@prisma/client"
import { loadSource } from "./source.mts"

type CoordinationModule = typeof import("../../lib/coordination.ts")
type PresenceModule = typeof import("../../lib/presence.ts")

const { REQUEST_TIMEOUT_MS, STALE_MS } =
  loadSource<PresenceModule>("lib/presence.ts")

export const CONNECTION_ID = "00000000-0000-4000-8000-000000000001"
export const NEXT_CONNECTION_ID = "00000000-0000-4000-8000-000000000002"

// Keep coordination rules real; substitute only its database boundary.
export function loadCoordinationModule(prisma: unknown) {
  return loadSource<CoordinationModule>(
    "lib/coordination.ts",
    {
      "@prisma/client": { Prisma },
      "@/lib/prisma": { prisma },
      "@/lib/presence": { REQUEST_TIMEOUT_MS, STALE_MS },
    },
    { Date },
  )
}
