import type { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { applyPrivacyOffset } from "@/lib/geo"
import { readJsonBody } from "@/lib/request"
import { createSessionCredentials, hashSessionToken } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const JoinBodySchema = z.object(
  {
    lat: z
      .number({ error: "invalid coordinates" })
      .min(-90, { error: "invalid coordinates" })
      .max(90, { error: "invalid coordinates" }),
    lng: z
      .number({ error: "invalid coordinates" })
      .min(-180, { error: "invalid coordinates" })
      .max(180, { error: "invalid coordinates" }),
  },
  { error: "invalid body" },
)

// POST /api/join — body { lat, lng } (raw coords).
// Always creates a fresh session; a supplied public ID cannot reclaim a dot.
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request)
  if (!body.success) {
    return Response.json({ error: "invalid body" }, { status: 400 })
  }

  const result = JoinBodySchema.safeParse(body.data)
  if (!result.success) {
    return Response.json(
      { error: result.error.issues[0].message },
      { status: 400 },
    )
  }

  const { lat, lng } = result.data
  const offset = applyPrivacyOffset(lat, lng)
  const { id, token } = createSessionCredentials()

  await prisma.presence.create({
    data: {
      id,
      tokenHash: hashSessionToken(token),
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
    },
  })

  return Response.json(
    { ok: true, id, token },
    { headers: { "Cache-Control": "no-store" } },
  )
}
