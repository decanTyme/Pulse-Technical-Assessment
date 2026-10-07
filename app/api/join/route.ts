import type { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { applyPrivacyOffset } from "@/lib/geo"
import { readJsonBody } from "@/lib/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const JoinBodySchema = z.object(
  {
    id: z.string({ error: "invalid id" }).refine(
      // Match the existing UTF-16 length rule, including non-BMP characters.
      (id) => id.length >= 8 && id.length <= 64,
      { error: "invalid id" },
    ),
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

// POST /api/join — body { id, lat, lng } (raw coords).
// Applies a 1–3 km privacy offset and upserts the presence row. Raw
// coordinates are never stored.
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

  const { id, lat, lng } = result.data
  const offset = applyPrivacyOffset(lat, lng)

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
  })

  return Response.json({ ok: true })
}
