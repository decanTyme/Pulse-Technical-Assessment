type JsonBodyResult = { success: true; data: unknown } | { success: false }

export async function readJsonBody(
  request: Pick<Request, "json">,
): Promise<JsonBodyResult> {
  try {
    const data: unknown = await request.json()
    return { success: true, data }
  } catch {
    // Keep parsing failures separate from valid JSON null; omit submitted data.
    return { success: false }
  }
}
