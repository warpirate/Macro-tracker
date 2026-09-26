import type OpenAI from 'openai'
import {
  BY_ID,
  CATALOG,
  clampServings,
  fromCatalog,
  fromEstimate,
  MAX_ITEMS,
  num,
  type LoggableFood,
} from './_catalog'
import { NO_THINKING } from './_nebius'

/*
  MEAL PHOTO ANALYSIS: THE MODEL NAMES THE FOOD, THE APP DOES THE MATHS.

  The first version asked the vision model for every macro directly, "using USDA-based
  values". For the people this app is for, that was wrong twice over. USDA has essentially no
  Indian dishes, so the model was inventing sambar from nothing; and a model asked for numbers
  gives different numbers for the same idli on different days, while search gives the
  catalog's. Photo logging and search disagreed about the same food.

  So the model now does the one thing it is good at, recognition: it picks dishes from the
  app's own catalog and counts them in that dish's serving ("3" for three idlis). Calories and
  macros come from the catalog row, which is what search and the diary already use. Only a
  food with no catalog match falls back to the model's own estimate.

  Shared by the /api/analyze-photo handler and the photo eval script, so the eval measures
  exactly what ships.
*/

/** Macros are TOTALS for `servings`, the shape the client already parses. */
export type PhotoFood = LoggableFood

export const buildPhotoPrompt = (mealType: string | undefined): string => `You identify the food in a meal photo for an Indian macro-tracking app. Most users are South Indian.
Meal context: ${mealType ?? 'unknown'}.

CATALOG (id | name | one serving):
${CATALOG}

For every distinct food visible:
1. Pick the closest catalog id. Prefer the regional dish over a generic one: a lentil-vegetable gravy served with rice or idli is sambar, not "soup"; a thin crisp rice-lentil crepe is a dosa.
2. Count "servings" in that catalog item's serving: three idlis on a plate with "Idli (1)" is 3. A heap of rice about twice a katori with "Cooked white rice (1 katori)" is 2. Halves are fine (0.5).
3. Chutneys, podi, pickle and curd on the side are separate items. So is ghee or oil you can see pooled on top.
4. Only if nothing in the catalog is close, set "id" to null and estimate the macros yourself for the quantity shown, using Indian home-cooking values (IFCT), never American ones.

Respond with ONLY a JSON array, no markdown fences, no commentary:
[{"id":"in043","servings":3},{"id":null,"name":"Beetroot poriyal","servings":1,"servingSize":100,"servingUnit":"g","calories":90,"protein":2,"carbs":10,"fat":5,"fiber":3,"sugar":6,"sodium":250,"category":"Vegetables"}]`

/**
 * Turns the model's reply into foods. Tolerates prose or fences around the array, unknown
 * ids (treated as estimates when they carry a name, dropped when they do not) and the same
 * dish listed twice (merged, so "idli" and "idli" do not become two diary rows).
 */
export const parsePhotoReply = (text: string): PhotoFood[] => {
  let raw: unknown = []
  try {
    const match = text.match(/\[[\s\S]*\]/)
    if (match) raw = JSON.parse(match[0])
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  /*
    No plate holds this many distinct foods. A reply this long is a model that has given up
    and pasted the catalog back (MiniCPM-V did exactly that in the photo eval: 130 "foods",
    27,000 kcal). Logging none of it is the only safe reading.
  */
  if (raw.length > MAX_ITEMS) return []

  const foods: PhotoFood[] = []
  const byFoodId = new Map<string, number>()

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const catalogFood = typeof item.id === 'string' ? BY_ID.get(item.id) : undefined
    const servings = clampServings(item.servings, catalogFood?.servingSize ?? num(item.servingSize) ?? 100)
    if (servings === null) continue

    if (catalogFood) {
      const seen = byFoodId.get(catalogFood.id)
      if (seen !== undefined) {
        const merged = clampServings(foods[seen].servings + servings, catalogFood.servingSize) ?? servings
        foods[seen] = fromCatalog(catalogFood, merged)
      } else {
        byFoodId.set(catalogFood.id, foods.length)
        foods.push(fromCatalog(catalogFood, servings))
      }
      continue
    }

    const estimate = fromEstimate(item, servings)
    if (estimate) foods.push(estimate)
  }

  return foods
}

// Re-exported for the eval script, which imports everything photo-related from here.
export { NO_THINKING }


/** One vision call, parsed. The caller owns the client, the model and the time budget. */
export const analyzeMealPhoto = async (
  client: OpenAI,
  model: string,
  imageUrl: string,
  mealType: string | undefined,
  requestOptions?: OpenAI.RequestOptions,
  extraBody: Record<string, unknown> = NO_THINKING,
): Promise<PhotoFood[]> => {
  const response = await client.chat.completions.create(
    {
      model,
      max_tokens: 1024,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: buildPhotoPrompt(mealType) },
        ],
      }],
      // Provider-specific fields; the SDK's types do not know them, the wire format does.
      ...(extraBody as object),
    },
    requestOptions,
  )
  return parsePhotoReply(response.choices[0]?.message?.content ?? '[]')
}
