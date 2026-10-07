import { readFileSync } from "node:fs"
import { parseEnv } from "node:util"
import { z } from "zod"

export const BASE_URL = "http://localhost:3000"

const DatabaseURLSchema = z.url({ protocol: /^postgres(ql)?$/ })

function loadEnv(filename: string): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(filename, "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return {}
  }
}

function getDatabaseIdentity(value: string) {
  const url = new URL(value)
  return `${url.hostname.replace("-pooler.", ".")}:${url.port || "5432"}${url.pathname}`
}

export function resolveDatabaseURL() {
  const result = DatabaseURLSchema.safeParse(
    loadEnv(".env.test.local").DATABASE_URL,
  )

  if (!result.success) {
    // A fixed message keeps malformed credentials out of logs.
    throw new Error(
      "Set DATABASE_URL in .env.test.local to a valid PostgreSQL connection URL. " +
        "Use an isolated test database; see tests/e2e/README.md.",
    )
  }

  // Catch accidentally pasting the normal development URL (including its direct
  // variant). This cannot identify every external alias; isolation is still required.
  const normalUrls = [
    process.env.DATABASE_URL,
    loadEnv(".env").DATABASE_URL,
    loadEnv(".env.local").DATABASE_URL,
  ]

  const testIdentity = getDatabaseIdentity(result.data)
  const sameDatabase = normalUrls.some((value) => {
    const normal = DatabaseURLSchema.safeParse(value)
    return normal.success && getDatabaseIdentity(normal.data) === testIdentity
  })

  if (sameDatabase) {
    throw new Error(
      "The test database URL points to the development database. Use an isolated test database.",
    )
  }

  return result.data
}
