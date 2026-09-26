import { client, VISION_MODEL, modelRequestOptions, requireApiKey } from './_nebius'
import { analyzeMealPhoto } from './_photo'
import { requireAiCaller } from './_auth'

export const config = { runtime: 'edge' }

/*
  Vision over a base64 upload is the slowest call in the app, and it passed no request
  options at all — so the SDK's defaults (`timeout: 600000`, `maxRetries: 2`) governed a
  function the edge runtime kills at 25s. A slow model could not fail gracefully; it could
  only be terminated, and the client saw a `FUNCTION_INVOCATION_TIMEOUT` 504.

  18s leaves room for the upload to finish arriving and for the JSON parse afterwards.
  Unlike /api/recommend there is no local fallback to protect here: a photo nobody looked at
  cannot be estimated on-device, so the budget goes to giving the model its best chance
  rather than to reserving time for a plan B that does not exist.
*/
const VISION_TIMEOUT_MS = 18000

/** About 6 MB of JPEG once decoded; far above what the app sends. */
const MAX_IMAGE_CHARS = 8_000_000

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  // Checked before the body is read: a stranger's megabyte of base64 is never parsed.
  const caller = await requireAiCaller(req, 'analyze-photo')
  if (caller instanceof Response) return caller

  try {
    requireApiKey()
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { imageBase64: string; mealType?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { imageBase64, mealType } = body
  if (!imageBase64) {
    return new Response(JSON.stringify({ error: 'imageBase64 required' }), { status: 400 })
  }
  /*
    The app resizes photos before sending (a few hundred kilobytes). A multi-megabyte image
    is either a bug or someone paying for vision tokens with our key, so it stops here.
  */
  if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_IMAGE_CHARS) {
    return new Response(JSON.stringify({ error: 'That photo is too large. Try again with a smaller one.' }), { status: 413 })
  }

  // Accept either a bare base64 payload or an already-formed data URL
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  try {
    // Recognition only; the macros come from the catalog. See ./_photo.ts for why.
    const foods = await analyzeMealPhoto(
      client,
      VISION_MODEL,
      imageUrl,
      mealType,
      modelRequestOptions(VISION_TIMEOUT_MS),
    )

    return new Response(JSON.stringify({ foods }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }
}
