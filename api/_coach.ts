import type OpenAI from 'openai'
import {
  BY_ID,
  catalogFor,
  CATEGORIES,
  clampServings,
  fromCatalog,
  fromEstimate,
  num,
  type LoggableFood,
} from './_catalog'

/*
  THE COACH.

  This used to be "a friendly fitness and nutrition assistant" that saw one thing: today. It
  had four tools and all of them wrote; it could log an idli but could not answer "why am I
  not losing weight?" with anything but generalities, because the answer lived in the last two
  weeks of the diary and it was never shown them. Closing the screen wiped the conversation,
  and nothing it was told about the person survived to the next one.

  Now the client sends a data pack with every turn (the last 14 days, the weight trend, the
  measured and predicted TDEE, the current plan, the coach alerts, the foods this person
  actually eats, and what they have asked the coach to remember), and the coach can:

    - log, correct and remove food, weight and water (as before, but catalog foods now carry
      the catalog's numbers, the same as search and photo logging);
    - offer a concrete meal the user can log with one tap (`offer_meal`);
    - propose new daily targets the user can apply with one tap (`propose_targets`), which is
      how the weekly check-in turns into a change;
    - remember and forget preferences (`remember`, `forget`).

  Offers and proposals are never applied on the model's say-so. They come back as actions the
  client renders as cards, and the person decides.
*/

// --- What the client sends --------------------------------------------------------------

export interface CoachDay {
  date: string
  calories: number
  protein: number
  carbs: number
  fat: number
  /** "Breakfast: Idli ×3, Sambar; Lunch: …" */
  foods: string
}

export interface CoachPack {
  /** The user's local time, written out: "Saturday 26 Sep, 20:14". */
  now?: string
  profile?: {
    name?: string
    goal?: string
    age?: number
    gender?: string
    heightCm?: number
    activityLevel?: string
  }
  /** The last 14 days before today, oldest first. Days with nothing logged are omitted. */
  days?: CoachDay[]
  /** Weigh-ins over the last 30 days, oldest first, in kg. */
  weights?: { date: string; kg: number }[]
  energy?: {
    predictedTdee?: number
    measuredTdee?: number | null
    confidence?: string
    trendKgPerWeek?: number | null
    daysOfData?: number
  }
  plan?: {
    phase: string
    calories: number
    protein: number
    carbs: number
    fat: number
    accepted: boolean
    ageDays: number
  } | null
  alerts?: string[]
  /** What they usually eat, most frequent first. */
  usualFoods?: { id: string; name: string; meal: string; servings: number }[]
  memory?: string[]
  /** The app's own on-device next-meal suggestion, if it has one. */
  nextMealIdea?: string
  /**
   * Today's water, steps and the last week of training, from the phone. Absent from 1.4.2
   * phones and the web app, in which case the prompt has no ACTIVITY section.
   */
  activity?: {
    water: { todayMl: number; goalMl: number; avg7Ml: number }
    /** null: Health Connect is not connected, so steps are unknown, not zero. */
    steps: { today: number; avg7: number } | null
    training: {
      today: { planned: string | null; done: string | null }
      week: { date: string; name: string; topSets: string; prs: string[] }[]
      weeklyGoal: { done: number; target: number } | null
    }
  }
}

export interface CoachContext {
  goals?: { calories: number; protein: number; carbs: number; fat: number }
  consumed?: { calories: number; protein: number; carbs: number; fat: number; fiber: number }
  todayCalories?: number
  todayEntries?: {
    id: string
    name: string
    meal: string
    calories: number
    protein?: number
    carbs?: number
    fat?: number
  }[]
  currentWeight?: string
  weightUnit?: 'lbs' | 'kg'
  coach?: CoachPack
  /** 'checkin' runs the weekly review; anything else is ordinary chat. */
  mode?: string
}

// --- Tools ------------------------------------------------------------------------------

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Pre-Workout', 'Post-Workout']

export const COACH_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'log_food',
      description:
        'Log one food the user ATE to today\'s diary. One call per distinct item. Only for food already eaten, never for a question like "what if I ate…".',
      parameters: {
        type: 'object',
        properties: {
          food_id: {
            type: 'string',
            description: 'Catalog id when the food is in the CATALOG. Then servings is in the catalog serving and every macro field may be omitted.',
          },
          name: { type: 'string', description: 'Descriptive name of the food' },
          meal: { type: 'string', enum: MEALS, description: 'Meal category; infer from context or time if not stated.' },
          servings: { type: 'number', description: 'How many servings were eaten (catalog servings when food_id is set).' },
          servingSize: { type: 'number', description: 'Size of ONE serving, numeric. Only without food_id.' },
          servingUnit: { type: 'string', description: 'Unit of the serving, e.g. g, ml, cup. Only without food_id.' },
          calories: { type: 'number', description: 'TOTAL kcal for the amount eaten. Required without food_id.' },
          protein: { type: 'number', description: 'TOTAL grams. Required without food_id.' },
          carbs: { type: 'number', description: 'TOTAL grams. Required without food_id.' },
          fat: { type: 'number', description: 'TOTAL grams. Required without food_id.' },
          fiber: { type: 'number' },
          sugar: { type: 'number' },
          sodium: { type: 'number', description: 'mg' },
          category: { type: 'string', enum: [...CATEGORIES] },
        },
        required: ['name', 'meal', 'servings'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_food',
      description: 'Remove an entry from today\'s diary by its id, to delete it or before re-logging a corrected version.',
      parameters: {
        type: 'object',
        properties: { entry_id: { type: 'string', description: 'Id from TODAY\'S LOGGED ENTRIES.' } },
        required: ['entry_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_weight',
      description: 'Log a body-weight measurement the user reports.',
      parameters: {
        type: 'object',
        properties: {
          weight: { type: 'number' },
          unit: { type: 'string', enum: ['lbs', 'kg'] },
          bodyFat: { type: 'number', description: 'Body fat percentage, if given.' },
        },
        required: ['weight', 'unit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_water',
      description: 'Log water or another plain fluid the user drank.',
      parameters: {
        type: 'object',
        properties: { amount_ml: { type: 'number', description: 'Millilitres; convert glasses (250 ml), cups, oz.' } },
        required: ['amount_ml'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'offer_meal',
      description:
        'Show the user a concrete meal they can log with one tap. Use whenever you suggest what to eat. Catalog foods only, at realistic portions, preferring foods from USUAL FOODS.',
      parameters: {
        type: 'object',
        properties: {
          meal: { type: 'string', enum: MEALS },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                food_id: { type: 'string' },
                servings: { type: 'number' },
              },
              required: ['food_id', 'servings'],
            },
          },
        },
        required: ['meal', 'items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_targets',
      description:
        'Propose new DAILY targets, shown as a card the user can apply. Use when the data says the current targets are not working, or in the weekly check-in. Never below the safety floor.',
      parameters: {
        type: 'object',
        properties: {
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          reason: { type: 'string', description: 'One sentence, citing the numbers that justify it.' },
        },
        required: ['calories', 'protein', 'carbs', 'fat', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        'Save a lasting fact about the user: diet (vegetarian, eggetarian, no beef), allergies, dislikes, routine (gym time, fasting days), goals, household cooking. Not one-off events.',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string', description: 'Short, third person: "Vegetarian; eats eggs".' } },
        required: ['fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Drop a remembered fact that is no longer true or that the user asks you to forget.',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string', description: 'The fact as it appears in MEMORY.' } },
        required: ['fact'],
      },
    },
  },
]

// --- Resolving what the model asked for --------------------------------------------------

export type CoachAction =
  | { tool: 'log_food'; input: LoggableFood & { meal: string } }
  | { tool: 'remove_food'; input: { entry_id: string } }
  | { tool: 'log_weight'; input: { weight: number; unit: 'kg' | 'lbs'; bodyFat?: number } }
  | { tool: 'log_water'; input: { amount_ml: number } }
  | { tool: 'offer_meal'; input: { meal: string; items: (LoggableFood & { foodId: string })[] } }
  | { tool: 'propose_targets'; input: { calories: number; protein: number; carbs: number; fat: number; reason: string } }
  | { tool: 'remember'; input: { fact: string } }
  | { tool: 'forget'; input: { fact: string } }

const mealOf = (value: unknown): string => (typeof value === 'string' && MEALS.includes(value) ? value : 'Snacks')

const text = (value: unknown, max = 160): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed.slice(0, max) : null
}

/** Daily calorie floor. Below this, no target is proposed whatever the model says. */
export const calorieFloor = (gender: string | undefined): number => (gender === 'female' ? 1200 : 1500)

/**
 * Turns one raw tool call into an action the client can apply, or null when it cannot be
 * trusted. Numbers for catalog foods come from the catalog; targets are clamped to safe,
 * internally consistent ranges.
 */
export const resolveAction = (
  name: string,
  input: Record<string, unknown>,
  context: CoachContext,
): CoachAction | null => {
  switch (name) {
    case 'log_food': {
      const catalogFood = typeof input.food_id === 'string' ? BY_ID.get(input.food_id) : undefined
      /*
        A missing count is one serving. The model often leaves it out when the amount is already
        in servingSize ("300 g kichidi" -> servingSize 300 and totals for it), and refusing those
        calls is how "logged it" replies came back with nothing in the diary.
      */
      const servings = clampServings(input.servings ?? 1, catalogFood?.servingSize ?? num(input.servingSize) ?? 100)
      if (servings === null) return null
      if (catalogFood) return { tool: 'log_food', input: { ...fromCatalog(catalogFood, servings), meal: mealOf(input.meal) } }
      // Without a catalog row the model's own figures are all there is, so they must exist.
      if (num(input.calories) === null) return null
      const estimate = fromEstimate(input, servings)
      return estimate ? { tool: 'log_food', input: { ...estimate, meal: mealOf(input.meal) } } : null
    }
    case 'remove_food': {
      const id = text(input.entry_id, 80)
      return id ? { tool: 'remove_food', input: { entry_id: id } } : null
    }
    case 'log_weight': {
      const weight = num(input.weight)
      if (weight === null || weight <= 0) return null
      if (input.unit !== 'kg' && input.unit !== 'lbs') return null
      const bodyFat = num(input.bodyFat)
      return {
        tool: 'log_weight',
        input: bodyFat !== null && bodyFat > 0 ? { weight, unit: input.unit, bodyFat } : { weight, unit: input.unit },
      }
    }
    case 'log_water': {
      const ml = num(input.amount_ml)
      return ml !== null && ml > 0 && ml <= 5000 ? { tool: 'log_water', input: { amount_ml: ml } } : null
    }
    case 'offer_meal': {
      const raw = Array.isArray(input.items) ? input.items : []
      const items = raw
        .map(item => {
          if (typeof item !== 'object' || item === null) return null
          const row = item as Record<string, unknown>
          const food = typeof row.food_id === 'string' ? BY_ID.get(row.food_id) : undefined
          if (!food) return null
          const servings = clampServings(row.servings, food.servingSize)
          return servings === null ? null : { ...fromCatalog(food, servings), foodId: food.id }
        })
        .filter((item): item is LoggableFood & { foodId: string } => item !== null)
        .slice(0, 6)
      return items.length > 0 ? { tool: 'offer_meal', input: { meal: mealOf(input.meal), items } } : null
    }
    case 'propose_targets': {
      const floor = calorieFloor(context.coach?.profile?.gender)
      const calories = num(input.calories)
      const protein = num(input.protein)
      const carbs = num(input.carbs)
      const fat = num(input.fat)
      const reason = text(input.reason, 280)
      if (calories === null || protein === null || carbs === null || fat === null || reason === null) return null
      if (calories < floor || calories > 5000) return null
      if (protein < 30 || carbs < 0 || fat < 20) return null
      // The macros must add up to the calories, within 10%; otherwise the card would promise
      // one number and the ring would show another.
      const fromMacros = protein * 4 + carbs * 4 + fat * 9
      if (Math.abs(fromMacros - calories) / calories > 0.1) return null
      /*
        Direction guard. In testing the model answered a stalled cut by RAISING calories,
        reasoning that the person was eating more than the target anyway. A target change in
        the wrong direction is the one proposal that is worse than none, so it is refused here
        rather than trusted to the prompt: on a cut, calories go up only when weight is
        falling faster than 1% of body weight a week; on a gain, down only when rising faster
        than 0.5 kg a week.
      */
      const current = context.goals?.calories
      const trend = context.coach?.energy?.trendKgPerWeek
      const goal = context.coach?.profile?.goal ?? ''
      const weights = context.coach?.weights ?? []
      const weightKg = weights.length > 0 ? weights[weights.length - 1].kg : undefined
      if (current !== undefined && /lose|cut/i.test(goal) && calories > current) {
        const fastLoss = trend != null && weightKg !== undefined && trend < -0.01 * weightKg
        if (!fastLoss) return null
      }
      if (current !== undefined && /gain|bulk/i.test(goal) && calories < current) {
        if (!(trend != null && trend > 0.5)) return null
      }
      return {
        tool: 'propose_targets',
        input: {
          calories: Math.round(calories),
          protein: Math.round(protein),
          carbs: Math.round(carbs),
          fat: Math.round(fat),
          reason,
        },
      }
    }
    case 'remember':
    case 'forget': {
      const fact = text(input.fact, 120)
      return fact ? { tool: name, input: { fact } } : null
    }
    default:
      return null
  }
}

/** What the model is told each tool did, for the reply it writes afterwards. */
export const describeAction = (action: CoachAction): string => {
  switch (action.tool) {
    case 'log_food':
      return `Logged: ${action.input.name} ×${action.input.servings} (${action.input.calories} kcal, ${action.input.protein} g protein)`
    case 'remove_food':
      return `Removed entry ${action.input.entry_id}`
    case 'log_weight':
      return `Logged weight: ${action.input.weight} ${action.input.unit}`
    case 'log_water':
      return `Logged water: ${action.input.amount_ml} ml`
    case 'offer_meal': {
      const kcal = action.input.items.reduce((sum, item) => sum + item.calories, 0)
      const protein = action.input.items.reduce((sum, item) => sum + item.protein, 0)
      return `Shown as a card with a "Log this" button, NOT logged yet: ${action.input.items.map(i => `${i.name} ×${i.servings}`).join(', ')} = ${kcal} kcal, ${Math.round(protein)} g protein.`
    }
    case 'propose_targets':
      return `Shown as a card with an "Apply" button, NOT applied yet: ${action.input.calories} kcal, P${action.input.protein} C${action.input.carbs} F${action.input.fat}.`
    case 'remember':
      return `Saved to memory: ${action.input.fact}`
    case 'forget':
      return `Removed from memory: ${action.input.fact}`
  }
}

/**
 * Catalog ids and tool names are for tool calls, but a model sometimes writes them into the
 * reply ("add 2 boiled eggs (in087 ×2)"). The prompt forbids it; this makes sure.
 */
export const scrubReply = (reply: string): string =>
  reply
    .replace(/\s*\((?:[a-z]{1,2}\d{3})(?:\s*[×x]\s*\d+(?:\.\d+)?)?\)/gi, '')
    .replace(/\b(?:in|sw|[a-z])\d{3}\b\s*/gi, '')
    .replace(/\b(?:log_food|offer_meal|propose_targets|remove_food|log_weight|log_water)\b(?:\(\))?/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

/**
 * A reply telling the user food just went into their diary. Success wording only: "you
 * haven't logged anything yet" must not match.
 */
const CLAIMS_LOGGED =
  /(?:^|\n)\s*logged\b|\bi(?:'ve| have)? (?:just )?logged\b|\blogged (?:as|under|for|it|that|your|\d)|\blogging (?:\d|it|that|now|your|the|this)\b|\b(?:added|saved) (?:it |that |this )?(?:to|in|under) (?:your )?(?:breakfast|lunch|dinner|snacks?|diary|log)\b/i
const CLAIMS_ALREADY = /\balready logged\b/i

/**
 * The model's reply, unless it says food was logged when no log_food went through. It does
 * that despite being told not to (after a refused call, or with no call at all), and the user
 * then hunts for an entry that does not exist. The diary is the truth; the reply must match it.
 *
 * "Already logged" is true when today has entries (the model declining a duplicate), and
 * the same lie when today is empty.
 */
export const honestReply = (reply: string, actions: CoachAction[], context: CoachContext): string => {
  if (actions.some(a => a.tool === 'log_food')) return reply
  const todayEmpty = (context.todayEntries?.length ?? 0) === 0
  return CLAIMS_LOGGED.test(reply) || (todayEmpty && CLAIMS_ALREADY.test(reply))
    ? "That didn't go into your diary. Send the food and how much, like \"300 g kichidi for breakfast\", and I'll log it."
    : reply
}

/** Why a tool call was refused, so the model does not claim it happened. */
export const REFUSED = 'Refused: the arguments were unusable (unknown food id, missing numbers, or targets outside safe limits). Do not claim this happened.'

// --- The prompt -------------------------------------------------------------------------

const round = (value: number | undefined | null): string =>
  value === undefined || value === null || !Number.isFinite(value) ? 'unknown' : String(Math.round(value))

const renderDays = (days: CoachDay[] | undefined): string => {
  if (!days || days.length === 0) return '  (nothing logged in the last 14 days)'
  return days
    .map(d => `  ${d.date}: ${Math.round(d.calories)} kcal, P${Math.round(d.protein)} C${Math.round(d.carbs)} F${Math.round(d.fat)} | ${d.foods}`)
    .join('\n')
}

const renderWeights = (weights: CoachPack['weights']): string => {
  if (!weights || weights.length === 0) return '  (no weigh-ins in the last 30 days)'
  return '  ' + weights.map(w => `${w.date} ${w.kg.toFixed(1)}`).join(', ')
}

const litres = (ml: number): string => (ml / 1000).toFixed(1)

/**
 * Whether today's water is behind, worked out here rather than left to the model: asked for a
 * snack at 15:00 with 0.6 of 3 L drunk, it never did the arithmetic and said nothing. Same rule
 * as the phone's opener line (src/lib/activity.ts): an even share of the goal from 07:00 to
 * 22:00, behind below 60% of it, and only from noon. `now` is the phone's "Tuesday 29 Sep, 15:00".
 */
const waterPace = (water: NonNullable<CoachPack['activity']>['water'], now: string | undefined): string => {
  const clock = now?.match(/(\d{1,2}):(\d{2})\s*$/)
  if (!clock || water.goalMl <= 0) return ''
  const hour = Number(clock[1]) + Number(clock[2]) / 60
  const expectedMl = (water.goalMl * Math.min(1, Math.max(0, (hour - 7) / 15)))
  if (hour >= 12 && water.todayMl < 0.6 * expectedMl) {
    return `; BEHIND pace (about ${litres(expectedMl)} L expected by ${clock[1]}:${clock[2]})`
  }
  return '; on pace'
}

const renderActivity = (activity: CoachPack['activity'], now: string | undefined): string => {
  if (!activity) return ''
  const { water, steps, training } = activity
  const today = training.today.done
    ? `done: ${training.today.done}`
    : training.today.planned
      ? `planned: ${training.today.planned}, not done yet`
      : 'rest or nothing planned'
  const lines = [
    'ACTIVITY (context for WHAT and WHEN to eat; it never changes calorie targets)',
    `  Water: ${litres(water.todayMl)} L of ${litres(water.goalMl)} L today, 7-day average ${litres(water.avg7Ml)} L${waterPace(water, now)}`,
    `  Steps: ${steps ? `${steps.today} today, usual ${steps.avg7}` : 'not connected (Health Connect is off); never estimate them'}`,
    `  Training today: ${today}`,
  ]
  if (training.weeklyGoal) lines.push(`  This week: ${training.weeklyGoal.done} of ${training.weeklyGoal.target} sessions`)
  if (training.week.length === 0) lines.push('  (no workouts in the last 7 days)')
  for (const s of training.week) {
    lines.push(`  ${s.date} ${s.name}: ${s.topSets || 'no weighted sets'}${s.prs.length ? ` | PRs: ${s.prs.join(', ')}` : ''}`)
  }
  return `${lines.join('\n')}\n`
}

export const buildCoachPrompt = (context: CoachContext, lastUserMessage = ''): string => {
  const pack = context.coach ?? {}
  const entries = context.todayEntries ?? []
  const goals = {
    calories: context.goals?.calories ?? 2000,
    protein: context.goals?.protein ?? 120,
    carbs: context.goals?.carbs ?? 220,
    fat: context.goals?.fat ?? 65,
  }
  const consumed = context.consumed ?? {
    calories: context.todayCalories ?? 0,
    protein: entries.reduce((s, e) => s + (e.protein ?? 0), 0),
    carbs: entries.reduce((s, e) => s + (e.carbs ?? 0), 0),
    fat: entries.reduce((s, e) => s + (e.fat ?? 0), 0),
    fiber: 0,
  }
  const left = (goal: number, eaten: number) => Math.round(goal - eaten)
  const profile = pack.profile ?? {}
  const energy = pack.energy ?? {}
  const plan = pack.plan
  const floor = calorieFloor(profile.gender)

  const entryLines = entries.length
    ? entries
        .map(e => {
          const macros =
            e.protein === undefined ? '' : `, P${Math.round(e.protein ?? 0)} C${Math.round(e.carbs ?? 0)} F${Math.round(e.fat ?? 0)}`
          return `  - [${e.id}] ${e.name} (${e.meal}, ${Math.round(e.calories)} kcal${macros})`
        })
        .join('\n')
    : '  (none yet)'

  const checkin =
    context.mode === 'checkin'
      ? `
THIS TURN IS THE WEEKLY CHECK-IN. The user tapped "Weekly check-in". Do this, briefly:
1. The week in numbers: average calories and protein on logged days vs targets, how many days logged, weight change (first vs last weigh-in, and the trend).
2. FIRST compare what they ATE with the TARGET. If they averaged more than 100 kcal over target on a cut (or under on a gain), the target was never tested: the fix is sticking to it, not a new number. Say so plainly, name the days or foods that caused it, and do NOT call propose_targets.
3. Only if they actually ate close to target (within 100 kcal) and weight is not moving at the goal's rate (cut: 0.25-1% of body weight per week down; lean bulk: 0.1-0.25 kg/week up; maintain: flat) call propose_targets: cut stalled means LOWER calories by 100-250; losing faster than 1%/week means raise them. Keep protein at 1.6-2.2 g per kg.
4. Under 4 logged days: the data is too thin, change nothing.
5. One specific habit for next week, built on their own foods, and back it with offer_meal when it is a food.
`
      : ''

  return `You are the MacroFit coach, a nutrition coach inside a macro-tracking app. Your users are mostly South Indian (Tamil, Telugu, Kannada, Malayalam homes): idli, dosa, pesarattu, rice with sambar, rasam, kuzhambu, poriyal, curd rice, chapati, chicken or fish curry, filter coffee. Coach them in THEIR food, never a Western meal plan.

WHO YOU ARE
- A knowledgeable friend who has read their diary: direct, warm, specific. Numbers first, then one practical move.
- You notice patterns across days (protein low on rice-heavy days, weekends over, dinners late) and name them with their foods.
- You never shame, moralise or catastrophise. No "cheat meal" talk.
- You are not a doctor. For medical conditions, pregnancy, eating-disorder signs (purging, fasting for days, extreme restriction, fear of food) respond with care, do not give a deficit, and suggest a doctor or registered dietitian.
- Never recommend or apply a daily target below ${floor} kcal.

NOW: ${pack.now ?? 'unknown'}

PROFILE
  Name: ${profile.name ?? 'unknown'} | Goal: ${profile.goal ?? 'unknown'} | Age: ${round(profile.age)} | Gender: ${profile.gender ?? 'unknown'} | Height: ${round(profile.heightCm)} cm | Activity: ${profile.activityLevel ?? 'unknown'}
  Current weight: ${context.currentWeight ?? 'unknown'} (user's unit: ${context.weightUnit ?? 'kg'})

MEMORY (what they told you before; respect it, e.g. never offer meat to a vegetarian)
${pack.memory && pack.memory.length ? pack.memory.map(m => `  - ${m}`).join('\n') : '  (nothing yet)'}

TODAY SO FAR (exact, computed by the app; use as given, never call them estimates)
  Calories: goal ${goals.calories}, eaten ${Math.round(consumed.calories)}, left ${left(goals.calories, consumed.calories)}
  Protein: goal ${goals.protein} g, eaten ${Math.round(consumed.protein)} g, left ${left(goals.protein, consumed.protein)} g
  Carbs: goal ${goals.carbs} g, eaten ${Math.round(consumed.carbs)} g, left ${left(goals.carbs, consumed.carbs)} g
  Fat: goal ${goals.fat} g, eaten ${Math.round(consumed.fat)} g, left ${left(goals.fat, consumed.fat)} g
TODAY'S LOGGED ENTRIES (with ids)
${entryLines}
${pack.nextMealIdea ? `APP'S NEXT-MEAL IDEA (built from their own history): ${pack.nextMealIdea}\n` : ''}
LAST 14 DAYS (before today)
${renderDays(pack.days)}

WEIGHT, kg (last 30 days)
${renderWeights(pack.weights)}

ENERGY
  Predicted TDEE ${round(energy.predictedTdee)} kcal | Measured TDEE ${energy.measuredTdee == null ? 'not enough data' : round(energy.measuredTdee)} kcal (confidence ${energy.confidence ?? 'none'}, ${round(energy.daysOfData)} days) | Weight trend ${energy.trendKgPerWeek == null ? 'unknown' : `${energy.trendKgPerWeek.toFixed(2)} kg/week`}

${renderActivity(pack.activity, pack.now)}CURRENT PLAN
  ${plan ? `${plan.phase}: ${plan.calories} kcal, P${plan.protein} C${plan.carbs} F${plan.fat}, set ${plan.ageDays} days ago, ${plan.accepted ? 'in use' : 'not applied'}` : 'none'}
${pack.alerts && pack.alerts.length ? `APP ALERTS\n${pack.alerts.map(a => `  - ${a}`).join('\n')}\n` : ''}
USUAL FOODS (id, meal, usual servings)
${pack.usualFoods && pack.usualFoods.length ? pack.usualFoods.map(f => `  ${f.id} ${f.name} | ${f.meal} | ×${f.servings}`).join('\n') : '  (no history yet)'}

CATALOG (id | name | one serving): the foods relevant to this turn. Use these ids for log_food and offer_meal; for a food not listed, log_food without food_id and give the macros.
${catalogFor(lastUserMessage, (pack.usualFoods ?? []).map(f => f.id))}
${checkin}
HOW TO ACT
1. Food the user says they ATE: log_food once per item. Use the catalog id whenever the food is in the catalog; count servings in that item's serving ("3 idli" with "Idli (1)" = 3; "2 cups rice" ≈ 2 katori). Log cooking oil or ghee separately only when mentioned. A question ("what if I had…") is NOT a log.
   A food with an amount is a report of what they ate, with or without a sentence around it: "breakfast\nkichidi rice 300gms", "lunch - 2 chapati, dal", "300g curd rice" are all log_food, never meal ideas. A meal word in the message is the meal to log it under.
   Keep their dish: kichidi is kichidi, not plain rice. When it is not in the catalog, log it under their name with your best estimate of that dish.
   "Log it", "add it", "do it": log the food from their previous message.
2. TODAY'S LOGGED ENTRIES is the only record of what is logged. Your earlier messages are not: if one said a food was logged and it is not in TODAY'S LOGGED ENTRIES, it was not logged, so log it now. Never log something that IS already there. To correct ("it was 4 idli, not 3"): remove_food, then log_food.
3. Weight mentioned: log_weight. Water or plain fluids: log_water.
4. Whenever you suggest what to eat, call offer_meal with catalog foods sized to what is left, favouring USUAL FOODS and respecting MEMORY. Then describe it in one line.
5. When they tell you a lasting preference or routine, call remember. When they say it changed, call forget.
6. Questions about progress ("why am I not losing?", "how was my week?"): answer from the 14 days, weights and energy above. Name the actual cause with numbers (e.g. "you averaged 2,340 kcal on 5 logged days against 1,900"). If data is thin, say so.
7. Propose new targets (propose_targets) only when the data supports it, or in the check-in.
8. ACTIVITY shapes what and when, never how much: never add calories for steps or workouts, because the targets already come from the weigh-in trend in ENERGY. If asked to "eat back" activity, say that in one line, then help place today's remaining calories: carbs around training, protein spread across meals, a recovery meal after a session. When the Water line says BEHIND, add one short water nudge to your answer whatever the question (e.g. a glass of water or buttermilk with the snack); otherwise do not bring water up. A session "not done yet" is still to come today: never say it was completed. When steps are not connected, never guess a number; you may suggest connecting Health Connect once.

HOW TO WRITE (a chat bubble on a phone, ~300 points wide)
- At most six short lines. Answer the question in the first line, with the number that matters.
- No Markdown tables, no headings. **Bold** only the key number. Bullets "- " allowed, one line each.
- Use their food names ("pesarattu", "curd rice"), not "a protein-rich breakfast".
- Do not repeat arithmetic they can see, and do not hedge on the TODAY figures.
- NEVER show catalog ids (like in043) or tool names in the text. They are for tool calls only.
- NEVER state calorie or protein totals for a meal you suggest: the offer card beside your reply shows the app's exact figures, and your arithmetic will not match them. Name the foods; let the card do the numbers.
- After logging food: one line confirming what went in and what is left for the day (from TODAY SO FAR minus what you just logged), then at most one tip.
- Never write that food is logged, added or saved unless you called log_food for it in this reply. Saying so without the call puts nothing in their diary.
- Keep one verdict per reply. Do not call progress "on track" and "too slow" in the same answer.`
}
