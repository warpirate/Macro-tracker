import { API_KEY, client, CHAT_MODEL } from './_nebius'
import { buildLocalRecommendation, clampRecommendationNumbers } from '../src/utils/localRecommendation'
import type {
  BodyComposition,
  CoachAlert,
  MacroGoals,
  PhaseType,
  Recommendation,
  TdeeEstimate,
  UserProfile,
  WeightGoal,
} from '../src/types'

export const config = { runtime: 'edge' }

/** Give up on the model well inside Vercel's edge limit so the fallback still ships. */
const MODEL_TIMEOUT_MS = 20000

/** Bounds from SPEC-COACH-AND-WORKOUT.md 1.3 that the shared clamp helper does not cover. */
const RATE_MIN_KG_PER_WEEK = -1.5
const RATE_MAX_KG_PER_WEEK = 1.0
const DURATION_MIN_WEEKS = 4
const DURATION_MAX_WEEKS = 24

/** Sanity bounds on bodyweight. Outside these the request is malformed, not extreme. */
const MIN_HUMAN_WEIGHT_KG = 25
const MAX_HUMAN_WEIGHT_KG = 400

const PHASES: readonly PhaseType[] = ['cut', 'lean_bulk', 'maintain', 'recomp']
const GOALS: readonly WeightGoal[] = ['lose', 'maintain', 'gain']

/** Rolling average intake over a recent window, precomputed by the client. */
interface RecentMacros {
  days?: number
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
}

/**
 * Everything the client precomputes. Fields are optional because the body arrives over the
 * wire untrusted — the handler degrades rather than trusting any of it blindly.
 */
interface RecommendRequest {
  profile?: Partial<UserProfile> | null
  currentWeightKg?: number | null
  goals?: Partial<MacroGoals> | null
  bodyComp?: BodyComposition | null
  tdee?: Partial<TdeeEstimate> | null
  recentMacros?: RecentMacros | null
  alerts?: CoachAlert[] | null
}

/** Ground-truth numbers derived from the request, shared by the AI and fallback paths. */
interface RecContext {
  goal: WeightGoal
  weightKg: number
  anchorTdee: number
  anchorSource: 'measured' | 'predicted'
  anchorReason: string
}

/** Returns a JSON Response with the given payload and status. */
const jsonResponse = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Returns the number when it is finite, otherwise null. */
const finiteOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Calorie band each phase implies, as a multiplier of the anchor TDEE.
 * Mirrors rule 1b of the prompt so the contract is enforced, not merely requested.
 */
const PHASE_CALORIE_BAND: Record<PhaseType, readonly [number, number]> = {
  cut: [0.75, 0.90],
  lean_bulk: [1.05, 1.15],
  maintain: [0.97, 1.03],
  recomp: [0.92, 1.00],
}

/**
 * Pulls a calorie target into the band implied by its phase. Returns the original value
 * and adjusted: false when it already agrees.
 */
const alignCaloriesToPhase = (
  calories: number,
  phase: PhaseType,
  anchorTdee: number,
): { calories: number; adjusted: boolean } => {
  const [lo, hi] = PHASE_CALORIE_BAND[phase]
  const min = anchorTdee * lo
  const max = anchorTdee * hi
  const bounded = Math.min(Math.max(calories, min), max)
  return { calories: bounded, adjusted: Math.abs(bounded - calories) > 0.5 }
}

/** Returns the number when it is finite and positive, otherwise null. */
const positiveOr = (value: unknown): number | null => {
  const n = finiteOr(value)
  return n !== null && n > 0 ? n : null
}

/** Returns the value rounded to `places` decimals; returns 0 for non-finite input. */
const round = (value: number, places = 0): number => {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Returns a human-readable number with a unit, or 'unknown' when the value is unusable. */
const show = (value: unknown, unit = '', places = 0): string => {
  const n = finiteOr(value)
  return n === null ? 'unknown' : `${round(n, places)}${unit}`
}

/** Returns true when the value is one of the four phase literals. */
const isPhase = (value: unknown): value is PhaseType =>
  typeof value === 'string' && (PHASES as readonly string[]).includes(value)

/** Returns true when the value is one of the three weight-goal literals. */
const isGoal = (value: unknown): value is WeightGoal =>
  typeof value === 'string' && (GOALS as readonly string[]).includes(value)

/** Returns the trimmed string when it is non-empty, otherwise null. */
const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Returns the first balanced `{...}` block in the text, or null when there is none.
 * String literals and backslash escapes are tracked so braces inside the rationale prose
 * cannot close the object early. This is what lets us tolerate markdown fences and any
 * stray commentary the model wraps around its JSON.
 */
const extractFirstJsonObject = (text: string): string | null => {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const ch = text.charAt(i)
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      if (inString) escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Returns the ground-truth context for this request: the goal, bodyweight and the TDEE
 * anchor the plan is built around. Never returns null — unusable inputs collapse to
 * neutral values that the local fallback and the clamp helper both already handle.
 */
const readContext = (input: RecommendRequest): RecContext => {
  const goal = isGoal(input.profile?.goal) ? input.profile.goal : 'maintain'
  // A missing bodyweight is not substituted — protein simply collapses to 0 g rather than
  // inventing a mass the user never entered. The local fallback behaves identically.
  const weightKg = positiveOr(input.currentWeightKg) ?? 0

  const predicted = positiveOr(input.tdee?.predicted)
  const measured = positiveOr(input.tdee?.measured)
  const confidence = input.tdee?.confidence
  // Measured TDEE beats a population formula only once there is enough data behind it;
  // at 'low' or 'none' the measurement is noisier than Mifflin/Katch, so the formula wins.
  const trustMeasured = measured !== null && (confidence === 'medium' || confidence === 'high')

  if (trustMeasured && measured !== null) {
    return {
      goal,
      weightKg,
      anchorTdee: measured,
      anchorSource: 'measured',
      anchorReason: `measured TDEE is used as the anchor because its confidence is ${String(confidence)} (${show(input.tdee?.daysOfData)} days of paired intake and weight data), which beats a population formula`,
    }
  }

  return {
    goal,
    weightKg,
    anchorTdee: predicted ?? 0,
    anchorSource: 'predicted',
    anchorReason:
      measured === null
        ? 'predicted TDEE is used as the anchor because there is not yet enough paired intake and weight data to measure one'
        : `predicted TDEE is used as the anchor because the measured value only has ${String(confidence ?? 'none')} confidence, which is too thin to trust over the formula`,
  }
}

/** Returns the alert list rendered for the prompt, or a line saying there are none. */
const renderAlerts = (alerts: CoachAlert[] | null | undefined): string => {
  if (!Array.isArray(alerts) || alerts.length === 0) return '  (none)'
  return alerts
    .filter((a): a is CoachAlert => typeof a === 'object' && a !== null)
    .map(a => `  - [${String(a.severity)}] ${String(a.kind)} — ${String(a.title)}: ${String(a.detail)}`)
    .join('\n')
}

/** Returns the recent-intake line for the prompt, or a line saying the data is missing. */
const renderRecentMacros = (recent: RecentMacros | null | undefined): string => {
  if (!recent || typeof recent !== 'object') return '  (no recent intake data)'
  const days = finiteOr(recent.days)
  const window = days === null ? 'the recent window' : `the last ${round(days)} logged days`
  return `  Average over ${window}: ${show(recent.calories, ' kcal')}, ${show(recent.protein, ' g protein')}, ${show(recent.carbs, ' g carbs')}, ${show(recent.fat, ' g fat')}`
}

/** Returns the body-composition line for the prompt, or a line saying it is unmeasured. */
const renderBodyComp = (bodyComp: BodyComposition | null | undefined): string => {
  if (!bodyComp || typeof bodyComp !== 'object') {
    return '  Not measured — no usable Navy tape measurements on file.'
  }
  return `  Body fat ${show(bodyComp.bodyFatPct, '%', 1)}, lean mass ${show(bodyComp.leanMassKg, ' kg', 1)} (Navy tape method, measured ${String(bodyComp.measuredOn)})`
}

/** Returns the full system prompt: the user's ground truth plus the output contract. */
const buildSystemPrompt = (input: RecommendRequest, ctx: RecContext): string => {
  const profile = input.profile ?? {}
  const goals = input.goals ?? {}
  const tdee = input.tdee ?? {}

  return `You are the coaching engine inside MacroFit, a macro tracking app. You decide which
nutrition phase the user should run next and explain it in plain language.

EVERY NUMBER BELOW IS GROUND TRUTH, COMPUTED BY THE APP. Do not recompute it, do not
second-guess it, and do not invent any figure that is not listed here.

PROFILE
  Name: ${String(profile.name ?? 'unknown')} | Age: ${show(profile.age)} | Gender: ${String(profile.gender ?? 'unknown')}
  Height: ${show(profile.heightCm, ' cm')} | Activity level: ${String(profile.activityLevel ?? 'unknown')}
  Stated goal: ${ctx.goal}
  Current weight: ${show(ctx.weightKg, ' kg', 1)}

BODY COMPOSITION
${renderBodyComp(input.bodyComp)}

ENERGY EXPENDITURE
  Predicted TDEE: ${show(tdee.predicted, ' kcal/day')} (basis: ${String(tdee.basis ?? 'unknown')})
  Measured TDEE: ${tdee.measured === null || tdee.measured === undefined ? 'not available' : show(tdee.measured, ' kcal/day')}
  Confidence: ${String(tdee.confidence ?? 'none')} | Days of paired data: ${show(tdee.daysOfData)}
  Weight trend: ${tdee.weightTrendKgPerWeek === null || tdee.weightTrendKgPerWeek === undefined ? 'not available' : show(tdee.weightTrendKgPerWeek, ' kg/week', 2)}
  ANCHOR YOU MUST BUILD AROUND: ${show(ctx.anchorTdee, ' kcal/day')} — ${ctx.anchorReason}.

CURRENT GOALS IN THE APP
  ${show(goals.calories, ' kcal')}, ${show(goals.protein, ' g protein')}, ${show(goals.carbs, ' g carbs')}, ${show(goals.fat, ' g fat')}

RECENT INTAKE
${renderRecentMacros(input.recentMacros)}

ACTIVE ALERTS (computed locally from the user's own log)
${renderAlerts(input.alerts)}

THE FOUR PHASES — pick exactly one:
  cut        Sustained calorie deficit to lose fat. Choose when body fat is high, the user
             wants to lose, or a bulk has run long. Protein stays high to protect lean mass.
  lean_bulk  Modest surplus to add muscle with minimal fat gain. Choose when the user is
             lean enough and wants to gain, and can train consistently.
  maintain   Hold weight at the anchor. Choose after a long cut or bulk, when the user needs
             a diet break, or when the data is too thin to justify a swing in either direction.
  recomp     Eat at or just under maintenance with high protein and hard training to lose fat
             and add muscle at once. Choose for newer or returning lifters at moderate body
             fat, or when the user has stalled and does not want to swing hard either way.

RULES:
1. Anchor the calorie target to ${show(ctx.anchorTdee, ' kcal/day')}. Stay within 25% of it.
1b. The calorie target MUST match the direction of the phase you picked. A "lean bulk" at
   maintenance calories is a contradiction and will be rejected. Use these bands:
     cut        10-25% BELOW the anchor
     lean_bulk  5-15% ABOVE the anchor
     maintain   within 3% of the anchor
     recomp     0-8% BELOW the anchor
2. Protein must land between 1.4 and 3.0 g per kg of bodyweight.
3. Fat must be at least 0.5 g per kg of bodyweight (hormone health) and at most 45% of calories.
4. Carbs take the remaining calories.
5. targetRateKgPerWeek is negative for a cut, near zero for maintain or recomp, and small and
   positive for a lean bulk. It must sit between -1.5 and 1.0.
6. durationWeeks must sit between 4 and 24.
7. The rationale is 2-4 sentences of plain language and MUST cite the user's actual numbers
   from above — their anchor TDEE, weight, trend, body fat or recent intake. Never state a
   number you were not given, and never claim data exists when the section above says it does
   not. If the data is thin, say so plainly.
8. The headline is one short line, e.g. "Lean bulk for 12 weeks".

OUTPUT CONTRACT — reply with a SINGLE JSON object and nothing else. No markdown fences, no
commentary before or after. Exactly these keys:
{"phase":"cut|lean_bulk|maintain|recomp","calories":0,"protein":0,"carbs":0,"fat":0,"targetRateKgPerWeek":0,"durationWeeks":0,"headline":"","rationale":""}`
}

/** Returns a unique id for an AI-sourced recommendation created at `now`. */
const makeId = (now: number): string => `rec_ai_${now}_${Math.random().toString(36).slice(2, 10)}`

/**
 * Returns a validated, clamped Recommendation built from the model's raw reply, or null
 * when the reply cannot be trusted (no JSON, unknown phase, or any non-finite macro).
 * A null return is the caller's signal to serve the deterministic local plan instead.
 */
const buildAiRecommendation = (text: string, ctx: RecContext): Recommendation | null => {
  const jsonText = extractFirstJsonObject(text)
  if (jsonText === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const draft = parsed as Record<string, unknown>

  if (!isPhase(draft.phase)) return null

  const rawCalories = finiteOr(draft.calories)
  const rawProtein = finiteOr(draft.protein)
  const rawCarbs = finiteOr(draft.carbs)
  const rawFat = finiteOr(draft.fat)
  if (rawCalories === null || rawProtein === null || rawCarbs === null || rawFat === null) return null

  // A phase and a calorie target that disagree ("lean bulk" at maintenance) is the most
  // common way this model output goes wrong, and it is silently misleading rather than
  // obviously broken. Pull the target into the band its own phase implies BEFORE the
  // macro clamp, so downstream macros are derived from the corrected figure.
  const phaseAligned = alignCaloriesToPhase(rawCalories, draft.phase, ctx.anchorTdee)

  const macros = clampRecommendationNumbers(
    { calories: phaseAligned.calories, protein: rawProtein, carbs: rawCarbs, fat: rawFat },
    { anchorTdee: ctx.anchorTdee, weightKg: ctx.weightKg },
  )

  // Rate and duration are outside the shared helper's remit, so they are bounded here.
  const rawRate = finiteOr(draft.targetRateKgPerWeek) ?? 0
  const boundedRate = Math.min(Math.max(rawRate, RATE_MIN_KG_PER_WEEK), RATE_MAX_KG_PER_WEEK)

  const rawDuration = finiteOr(draft.durationWeeks) ?? DURATION_MIN_WEEKS
  const boundedDuration = Math.min(
    Math.max(Math.round(rawDuration), DURATION_MIN_WEEKS),
    DURATION_MAX_WEEKS,
  )

  const headline = nonEmptyString(draft.headline) ?? `${draft.phase.replace('_', ' ')} for ${boundedDuration} weeks`
  const rationale =
    nonEmptyString(draft.rationale) ??
    `Built around your ${round(ctx.anchorTdee)} kcal/day ${ctx.anchorSource} TDEE at ${round(ctx.weightKg, 1)} kg bodyweight.`

  const clamped =
    macros.clamped ||
    phaseAligned.adjusted ||
    boundedRate !== rawRate ||
    boundedDuration !== rawDuration
  const now = Date.now()

  return {
    id: makeId(now),
    createdAt: now,
    phase: draft.phase,
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    targetRateKgPerWeek: round(boundedRate, 2),
    durationWeeks: boundedDuration,
    headline,
    rationale,
    tdeeUsed: round(ctx.anchorTdee),
    source: 'ai',
    clamped,
  }
}

/**
 * Returns `{ recommendation }` for a POST body of precomputed coach inputs.
 * 405 for a non-POST method and 400 for a body that is not a JSON object; every other
 * failure — model error, timeout, unparseable reply, bad phase, non-finite macro — falls
 * back to the deterministic local plan with HTTP 200, so the client always gets a usable
 * recommendation.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonResponse({ error: 'Object body required' }, 400)
  }

  const input = body as RecommendRequest

  // A macro plan is meaningless without a bodyweight: every protein and fat bound is
  // g/kg, so a missing or absurd mass collapses those floors to zero and would emit a
  // "0 g protein, 0 g fat, all carbohydrate" plan. Refuse instead — the client always
  // has a weight, so this only fires on a genuinely malformed request.
  const weightKg = positiveOr(input.currentWeightKg)
  if (weightKg === null || weightKg < MIN_HUMAN_WEIGHT_KG || weightKg > MAX_HUMAN_WEIGHT_KG) {
    return jsonResponse(
      { error: `currentWeightKg is required and must be between ${MIN_HUMAN_WEIGHT_KG} and ${MAX_HUMAN_WEIGHT_KG} kg` },
      400,
    )
  }

  // Likewise an anchor: with no TDEE at all there is nothing to build the target around.
  if (positiveOr(input.tdee?.predicted) === null && positiveOr(input.tdee?.measured) === null) {
    return jsonResponse({ error: 'tdee.predicted or tdee.measured is required' }, 400)
  }

  const ctx = readContext(input)

  const localResponse = (): Response =>
    jsonResponse(
      {
        recommendation: buildLocalRecommendation({
          goal: ctx.goal,
          weightKg: ctx.weightKg,
          anchorTdee: ctx.anchorTdee,
        }),
      },
      200,
    )

  // No key on this deployment: the deterministic plan is the whole point of the local
  // fallback, so serve it rather than spending a request that can only fail.
  if (API_KEY === null) return localResponse()

  try {
    const response = await client.chat.completions.create(
      {
        model: CHAT_MODEL,
        max_tokens: 800,
        temperature: 0.3,
        messages: [
          { role: 'system', content: buildSystemPrompt(input, ctx) },
          { role: 'user', content: 'Give me my next phase as JSON.' },
        ],
      },
      { timeout: MODEL_TIMEOUT_MS, maxRetries: 1 },
    )

    const text = response.choices[0]?.message?.content ?? ''
    const recommendation = buildAiRecommendation(text, ctx)
    if (recommendation === null) return localResponse()

    return jsonResponse({ recommendation }, 200)
  } catch {
    // Network error, timeout, missing API key, upstream 5xx — the user still gets a plan.
    return localResponse()
  }
}
