import { client, VISION_MODEL, modelRequestOptions, requireApiKey } from './_nebius'

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

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

  // Accept either a bare base64 payload or an already-formed data URL
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`

  try {
    const response = await client.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          {
            type: 'text',
            text: `Analyze every food item visible in this photo. For each item estimate the quantity and macros.
Meal context: ${mealType ?? 'unknown'}.

Respond with ONLY a JSON array, no markdown fences:
[{"name":"...","servings":1,"servingSize":100,"servingUnit":"g","calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0,"sodium":0,"category":"Custom"}]

Use accurate USDA-based values. Account for cooking methods (oil, butter). If multiple foods are on the plate log each separately.`,
          },
        ],
      }],
    }, modelRequestOptions(VISION_TIMEOUT_MS))

    const text = response.choices[0]?.message?.content ?? '[]'
    let foods: unknown[] = []
    try {
      const match = text.match(/\[[\s\S]*\]/)
      if (match) foods = JSON.parse(match[0])
    } catch { /* return empty */ }

    return new Response(JSON.stringify({ foods }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }
}
