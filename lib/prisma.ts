import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// Prisma 7 connects through a driver adapter. We pass the (pooled) Postgres
// connection string to the pg adapter.
//
// Reuse a single PrismaClient across hot reloads (dev) and warm serverless
// invocations to avoid exhausting Postgres connections. Use a *pooled*
// connection string for DATABASE_URL in production (PgBouncer / Neon pooler).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set")
  }

  // Bound individual connection and query-response waits for coordination calls.
  // Routes with several operations can take longer than either limit.
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  })

  return new PrismaClient({
    adapter,
    // Keep Prisma's existing interactive transaction limits explicit.
    transactionOptions: { maxWait: 2_000, timeout: 5_000 },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
