import type OpenAI from 'openai'
import { client, CHAT_MODEL, requireApiKey } from './_nebius'

export const config = { runtime: 'edge' }

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'log_food',
      description: 'Log one food item to the diary. Call this once per distinct food item mentioned.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Descriptive name of the food' },
          meal: {
            type: 'string',
            enum: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Pre-Workout', 'Post-Workout'],
            description: 'Meal category. Guess based on context or time if not stated.',
          },
          servings: { type: 'number', description: 'Number of servings consumed' },
          servingSize: { type: 'number', description: 'Size of one serving (numeric)' },
          servingUnit: { type: 'string', description: 'Unit for serving size, e.g. g, oz, cup, lb, ml' },
          calories: { type: 'number', description: 'Total calories for this entry (servings × per-serving calories)' },
          protein: { type: 'number', description: 'Total protein in grams for this entry' },
          carbs: { type: 'number', description: 'Total carbohydrates in grams for this entry' },
          fat: { type: 'number', description: 'Total fat in grams for this entry' },
          fiber: { type: 'number', description: 'Total fiber in grams for this entry' },
          sugar: { type: 'number', description: 'Total sugar in grams for this entry' },
          sodium: { type: 'number', description: 'Total sodium in mg for this entry' },
          category: {
            type: 'string',
            enum: [
              'Fruits', 'Vegetables', 'Grains & Cereals', 'Dairy',
              'Meat & Poultry', 'Fish & Seafood', 'Legumes', 'Nuts & Seeds',
              'Beverages', 'Snacks', 'Fast Food', 'Condiments', 'Oils & Fats',
              'Sweets & Desserts', 'Custom',
            ],
            description: 'Food category',
          },
        },
        required: ['name', 'meal', 'servings', 'servingSize', 'servingUnit', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_weight',
      description: 'Log a body weight measurement',
      parameters: {
        type: 'object',
        properties: {
          weight: { type: 'number', description: 'Weight value' },
          unit: { type: 'string', enum: ['lbs', 'kg'], description: 'Unit of weight' },
          bodyFat: { type: 'number', description: 'Body fat percentage (optional)' },
        },
        required: ['weight', 'unit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_water',
      description: 'Log water or fluid intake',
      parameters: {
        type: 'object',
        properties: {
          amount_ml: { type: 'number', description: 'Amount in milliliters. Convert from oz or cups if needed.' },
        },
        required: ['amount_ml'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_food',
      description: 'Remove a previously logged food entry by its ID. Use this when the user wants to correct, replace, or delete a food they already logged today.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string', description: 'The ID of the diary entry to remove, from the list of today\'s logged entries.' },
        },
        required: ['entry_id'],
      },
    },
  },
]

/** Summary fed back to the model as the tool result, so it can write a closing message. */
function toolResultText(name: string, input: Record<string, unknown>): string {
  if (name === 'log_food') return `Logged: ${input.name} (${input.calories} kcal, ${input.protein}g protein)`
  if (name === 'remove_food') return `Removed entry ${input.entry_id}`
  if (name === 'log_weight') return `Logged weight: ${input.weight} ${input.unit}`
  if (name === 'log_water') return `Logged water: ${input.amount_ml} ml`
  return 'Done.'
}

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

  let body: { messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; context: Record<string, any> }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { messages, context } = body
  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'messages array required' }), { status: 400 })
  }

  const todayEntries = (context?.todayEntries as Array<{ id: string; name: string; meal: string; calories: number }> | undefined) ?? []
  const entriesList = todayEntries.length > 0
    ? todayEntries.map(e => `  - [${e.id}] ${e.name} (${e.meal}, ${Math.round(e.calories)} kcal)`).join('\n')
    : '  (none yet)'

  const systemPrompt = `You are a friendly fitness and nutrition assistant built into a macro tracker app called MacroFit.

USER CONTEXT:
- Calorie goal: ${context?.goals?.calories ?? 2000} kcal/day
- Protein goal: ${context?.goals?.protein ?? 150}g | Carbs: ${context?.goals?.carbs ?? 200}g | Fat: ${context?.goals?.fat ?? 65}g
- Calories logged today: ${context?.todayCalories ?? 0} kcal
- Current weight: ${context?.currentWeight ?? 'not set'}
- Weight unit preference: ${context?.weightUnit ?? 'lbs'}

TODAY'S LOGGED ENTRIES (with IDs):
${entriesList}

RULES:

LOGGING NEW FOOD:
1. When the user describes food they ate, call log_food once for EACH distinct food item. Do not skip any item, no matter how small or oddly described (e.g. "1/3 scoop protein powder", "5 tablespoons yogurt").
2. When cooking oils/fats are mentioned (e.g. "fried in olive oil"), log the oil separately as its own entry.
3. Provide accurate macro values based on your nutrition knowledge. The calories/protein/carbs/fat/fiber/sugar/sodium fields must be the TOTAL for the quantity described (not per 100g or per serving).
4. servingSize + servingUnit describe ONE serving. servings is how many they consumed.
5. If the meal type isn't stated, infer it from context (e.g. "for lunch" → Lunch).

DUPLICATE GUARD — CRITICAL:
6. Before calling log_food, check TODAY'S LOGGED ENTRIES above. If an item with the same or very similar name is already listed there, do NOT log it again. Skip it entirely.
7. If the user says you "missed" or "forgot" an item: look at TODAY'S LOGGED ENTRIES. Only call log_food for items not already in that list. Do NOT re-log items that are already there.

CORRECTIONS:
8. If the user wants to change an item already logged (e.g. "actually it was 5 eggs not 4", "change that to 2 cups"): call remove_food with the matching entry ID first, then call log_food with the corrected values.
9. If the user wants to remove an item: call remove_food only. Do not re-log it.

OTHER:
10. When the user mentions their weight, call log_weight.
11. When the user mentions drinking water or any fluid, call log_water.
12. After using tools, give a short friendly summary of what was logged.
13. If the user asks a general nutrition question, answer it — do not log anything.`

  try {
    const actions: Array<{ tool: string; input: Record<string, unknown> }> = []

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    // First turn
    const response = await client.chat.completions.create({
      model: CHAT_MODEL,
      max_tokens: 2048,
      tools,
      messages: convo,
    })

    const assistantMsg = response.choices[0]?.message
    const toolCalls = (assistantMsg?.tool_calls ?? []) as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]

    // Collect tool calls, skipping any whose arguments fail to parse
    const parsed: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    for (const call of toolCalls) {
      if (call.type !== 'function') continue
      let input: Record<string, unknown>
      try {
        input = JSON.parse(call.function.arguments || '{}')
      } catch {
        continue
      }
      parsed.push({ id: call.id, name: call.function.name, input })
      actions.push({ tool: call.function.name, input })
    }

    let finalText = ''
    if (parsed.length > 0) {
      // Feed tool results back so the model can write its closing summary
      const followUp = await client.chat.completions.create({
        model: CHAT_MODEL,
        max_tokens: 512,
        messages: [
          ...convo,
          assistantMsg!,
          ...parsed.map(p => ({
            role: 'tool' as const,
            tool_call_id: p.id,
            content: toolResultText(p.name, p.input),
          })),
        ],
      })
      finalText = followUp.choices[0]?.message?.content ?? ''
    } else {
      finalText = assistantMsg?.content ?? ''
    }

    return new Response(JSON.stringify({ text: finalText, actions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }
}
