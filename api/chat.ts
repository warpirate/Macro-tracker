import type OpenAI from 'openai'
import { client, CHAT_MODEL, modelRequestOptions, requireApiKey } from './_nebius'

export const config = { runtime: 'edge' }

/*
  Chat is the only handler here that makes TWO sequential model calls: one to pick tools,
  then one to write the closing summary once the tool results are known. Both live inside
  the same 25s edge invocation, so they share the budget rather than each getting it.

  Neither call passed options at all before this, which meant the SDK's own defaults —
  `timeout: 600000, maxRetries: 2` — governed a function the platform kills at 25s. A slow
  first call could not degrade; it could only 504.

  The split is uneven on purpose. The first call reasons over the whole conversation and
  emits up to 2048 tokens of tool calls; the second only writes prose over results it has
  already been handed, capped at 512. Splitting evenly would starve the half that does the
  work.
*/
const TOOL_CALL_TIMEOUT_MS = 13000
const SUMMARY_TIMEOUT_MS = 7000

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

/**
 * A plain summary of what the tools did, for when the model cannot write one.
 *
 * Deliberately not a fake assistant voice. The model's summary is a coached sentence; this
 * is a receipt, and reading like a receipt is the honest signal that the coach did not get
 * to speak. What matters is that the user can see exactly what landed in their diary — the
 * alternative on this path was an error that threw the logging away.
 */
function describeActions(
  parsed: ReadonlyArray<{ name: string; input: Record<string, unknown> }>,
): string {
  const lines = parsed.map(p => toolResultText(p.name, p.input))
  return lines.length === 1 ? lines[0] : lines.map(line => `• ${line}`).join('\n')
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

  interface ContextEntry {
    id: string
    name: string
    meal: string
    calories: number
    protein?: number
    carbs?: number
    fat?: number
  }

  const todayEntries = (context?.todayEntries as ContextEntry[] | undefined) ?? []

  /*
    Macros per entry, where the client sent them.

    They used to be omitted, so the model saw "Lemon rice (Lunch, 320 kcal)" and had to invent a
    protein figure from the name. It did, it flagged that it was estimating, and it was wrong —
    all while the exact number existed in the app. Older clients still send calories only, hence
    the conditional rather than a required field.
  */
  const describeEntry = (e: ContextEntry): string => {
    const macros =
      e.protein === undefined && e.carbs === undefined && e.fat === undefined
        ? ''
        : `, P${Math.round(e.protein ?? 0)}g C${Math.round(e.carbs ?? 0)}g F${Math.round(e.fat ?? 0)}g`
    return `  - [${e.id}] ${e.name} (${e.meal}, ${Math.round(e.calories)} kcal${macros})`
  }

  const entriesList = todayEntries.length > 0
    ? todayEntries.map(describeEntry).join('\n')
    : '  (none yet)'

  const goals = {
    calories: context?.goals?.calories ?? 2000,
    protein: context?.goals?.protein ?? 150,
    carbs: context?.goals?.carbs ?? 200,
    fat: context?.goals?.fat ?? 65,
  }

  /*
    Totals, computed by the app rather than by the model.

    `consumed` is authoritative and arrives already summed by the same function the diary and
    dashboard use, so the three cannot disagree. Falling back to `todayCalories` keeps a client
    that predates this field working, with calories right and macros absent rather than guessed.
  */
  const consumed = (context?.consumed as
    | { calories: number; protein: number; carbs: number; fat: number; fiber: number }
    | undefined) ?? {
    calories: context?.todayCalories ?? 0,
    protein: todayEntries.reduce((sum, e) => sum + (e.protein ?? 0), 0),
    carbs: todayEntries.reduce((sum, e) => sum + (e.carbs ?? 0), 0),
    fat: todayEntries.reduce((sum, e) => sum + (e.fat ?? 0), 0),
    fiber: 0,
  }

  const left = (goal: number, eaten: number): number => Math.round(goal - eaten)

  const systemPrompt = `You are a friendly fitness and nutrition assistant built into a macro tracker app called MacroFit.

USER CONTEXT:
- Current weight: ${context?.currentWeight ?? 'not set'}
- Weight unit preference: ${context?.weightUnit ?? 'lbs'}

TODAY SO FAR — these figures are exact, computed by the app. Use them as given. Never
recalculate them from the entry list and never describe them as estimates or approximations:
- Calories: goal ${goals.calories} kcal, consumed ${Math.round(consumed.calories)} kcal, remaining ${left(goals.calories, consumed.calories)} kcal
- Protein: goal ${goals.protein}g, consumed ${Math.round(consumed.protein)}g, remaining ${left(goals.protein, consumed.protein)}g
- Carbs: goal ${goals.carbs}g, consumed ${Math.round(consumed.carbs)}g, remaining ${left(goals.carbs, consumed.carbs)}g
- Fat: goal ${goals.fat}g, consumed ${Math.round(consumed.fat)}g, remaining ${left(goals.fat, consumed.fat)}g

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
13. If the user asks a general nutrition question, answer it — do not log anything.

HOW TO WRITE THE REPLY — this is a chat bubble on a phone, about 300 points wide:
14. Answer in at most six short lines. The user asked one question; answer that question first,
    in the first line, as a number they can act on.
15. NEVER use Markdown tables. Pipes and dashes do not render here — they arrive as literal
    punctuation and are unreadable at this width. State figures in a sentence or a short bullet.
16. NEVER use headings (#, ##, ###). A reply this short has nothing to organise, and the heading
    markers show up as literal hash characters.
17. **Bold** is supported and renders. Use it only on the number that answers the question.
18. Bullets starting "- " are supported. Keep them to one line each.
19. Do not restate the arithmetic you were given. "634 kcal left" is the answer; a breakdown of
    how 1034 minus 400 reaches it is padding the user already understands.
20. Do not include disclaimers about estimates when using the TODAY SO FAR figures. They are
    exact, and hedging on them makes the app look unsure of data it is certain about.`

  try {
    const actions: Array<{ tool: string; input: Record<string, unknown> }> = []

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ]

    // First turn
    const response = await client.chat.completions.create(
      {
        model: CHAT_MODEL,
        max_tokens: 2048,
        tools,
        messages: convo,
      },
      modelRequestOptions(TOOL_CALL_TIMEOUT_MS),
    )

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
      /*
        The tool calls are already parsed and already in `actions` at this point, so the
        work the user asked for is done. Only the sentence describing it is outstanding.

        This call therefore gets its own try/catch instead of riding the handler's. Letting
        it reach the outer catch returns a 500 and discards `actions` wholesale — the model
        logged the food, the summary timed out, and the client is told the turn failed. The
        user retypes it, and the second attempt logs everything twice.

        Losing the prose is a worse sentence. Losing the actions is lost data.
      */
      try {
        const followUp = await client.chat.completions.create(
          {
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
          },
          modelRequestOptions(SUMMARY_TIMEOUT_MS),
        )
        finalText = followUp.choices[0]?.message?.content ?? ''
      } catch {
        finalText = ''
      }
      // Covers both a failed call and a model that returned an empty string. The client
      // treats "no text and no actions" as a failed turn, so a summary-less success has to
      // say something — and it says what was actually done, not what the model would have
      // said about it.
      if (finalText.trim().length === 0) finalText = describeActions(parsed)
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
