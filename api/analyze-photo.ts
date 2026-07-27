import { client, VISION_MODEL } from './_nebius'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
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
    })

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
