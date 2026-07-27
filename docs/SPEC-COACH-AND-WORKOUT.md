# Spec — Coach (recommendation engine) + Workout tracking

Authoritative contracts. Types and store action names here are **exact** — other files
are written against them, so renaming anything breaks the build.

---

## Part 1 — Coach / recommendation engine

Approved architecture: app computes ground truth, AI decides and explains, output is
validated and clamped, deterministic fallback when offline or the call fails.
Recommendations are **proposed**, never auto-applied — the user taps Accept.

### 1.1 Types (append to `src/types/index.ts`)

```ts
export type PhaseType = 'cut' | 'lean_bulk' | 'maintain' | 'recomp'

export interface BodyComposition {
  bodyFatPct: number
  leanMassKg: number
  method: 'navy'          // Navy tape method from body measurements
  measuredOn: string      // 'YYYY-MM-DD' of the measurement used
}

export interface TdeeEstimate {
  predicted: number                 // Mifflin-St Jeor, or Katch-McArdle when LBM known
  basis: 'mifflin' | 'katch'
  measured: number | null           // from logged intake vs weight trend; null below threshold
  confidence: 'none' | 'low' | 'medium' | 'high'
  daysOfData: number                // days with BOTH intake and weight in the window
  weightTrendKgPerWeek: number | null
}

export interface Recommendation {
  id: string
  createdAt: number
  phase: PhaseType
  calories: number
  protein: number                   // grams
  carbs: number
  fat: number
  targetRateKgPerWeek: number       // negative for a cut
  durationWeeks: number
  headline: string                  // one short line, e.g. "Lean bulk for 12 weeks"
  rationale: string                 // 2-4 sentences, plain language, cites the user's data
  tdeeUsed: number
  source: 'ai' | 'local'            // 'local' = deterministic fallback was used
  clamped: boolean                  // true if AI numbers were pulled back into bounds
}

export type CoachAlertKind =
  | 'stalled' | 'bulk_too_long' | 'cut_too_long' | 'rate_too_fast'
  | 'rate_too_slow' | 'low_protein' | 'insufficient_data' | 'stale_recommendation'

export interface CoachAlert {
  id: string
  kind: CoachAlertKind
  severity: 'info' | 'warning'
  title: string
  detail: string
}
```

### 1.2 Pure modules (no React, no store, no network)

**`src/utils/bodyComposition.ts`**
- `estimateBodyComposition(profile, weightKg, measurement): BodyComposition | null`
- US Navy method. Male: needs neck + waist. Female: needs neck + waist + hips.
  Returns `null` if the required fields are missing — never guess.
- Formulas (metric, log base 10):
  - Male: `bf% = 495 / (1.0324 - 0.19077*log10(waist - neck) + 0.15456*log10(height)) - 450`
  - Female: `bf% = 495 / (1.29579 - 0.35004*log10(waist + hip - neck) + 0.22100*log10(height)) - 450`
- Clamp result to 3–60%. Return `null` outside that (bad tape measurements).
- `leanMassKg = weightKg * (1 - bf/100)`
- `katchMcArdleBMR(leanMassKg) = 370 + 21.6 * leanMassKg`
- Gender `'other'` uses the male formula; note it in a comment.

**`src/utils/tdee.ts`**
- `predictedTDEE(profile, weightKg, bodyComp | null): { value, basis }` — Katch-McArdle ×
  activity multiplier when `bodyComp` exists, else the existing Mifflin path. Reuse the
  multipliers already in `calculations.ts`; do not duplicate them.
- `measuredTDEE(diary, weightLog, profile, days = 28): TdeeEstimate['measured'] & co`
  - Window: last `days` days. A day counts only if it has ≥1 food entry **and** the
    window has ≥2 weight entries spanning ≥10 days.
  - `avgIntake` = mean calories over days with entries.
  - `trendKgPerWeek` = least-squares slope of weight vs time (kg/week). Use least
    squares, not first-vs-last — daily weight is noisy.
  - `measured = avgIntake - (trendKgPerWeek / 7) * 7700`
  - Confidence: `high` ≥21 qualifying days, `medium` ≥14, `low` ≥10, else `none` and
    `measured` is `null`.
  - Ignore days where logged calories < 500 (user forgot to log, not a fast).
- `buildTdeeEstimate(...)` returns the full `TdeeEstimate`.

**`src/utils/coachAlerts.ts`**
- `getCoachAlerts(state): CoachAlert[]` — pure, local, cheap, no network. Runs on every
  render. This is why alerts still work offline and between weekly AI calls.
- Rules:
  - `stalled` — weight trend within ±0.1 kg/week for ≥21 days while the goal is lose/gain.
  - `rate_too_fast` — losing >1% bodyweight/week, or gaining >0.5 kg/week.
  - `rate_too_slow` — cutting but trend is flat or up over 14 days.
  - `bulk_too_long` / `cut_too_long` — same phase for >16 weeks (infer from goal +
    weight-log span).
  - `low_protein` — 7-day average protein < 1.6 g/kg bodyweight.
  - `insufficient_data` — fewer than 10 qualifying days; explains what to log.
  - `stale_recommendation` — cached recommendation older than 14 days.
- Return at most 3, most severe first. Never fabricate a number that isn't computed.

### 1.3 API — `api/recommend.ts` (new Vercel Edge Function)

Uses the shared client in `api/_nebius.ts` (`CHAT_MODEL`). Mirror the structure and
error handling of `api/chat.ts`.

**Request body:** `{ profile, currentWeightKg, goals, bodyComp, tdee, recentMacros, alerts }`
— all precomputed by the client. The model receives ground truth, it does not do math.

**The model must return JSON only**, via this shape:
```json
{ "phase": "lean_bulk", "calories": 2750, "protein": 165, "carbs": 300, "fat": 85,
  "targetRateKgPerWeek": 0.25, "durationWeeks": 12,
  "headline": "...", "rationale": "..." }
```

**Validation and clamping — non-negotiable, this is the whole point of the design:**
1. Anchor = `tdee.measured ?? tdee.predicted`.
2. `calories` must be within ±25% of the anchor. Outside → clamp to the bound and set
   `clamped: true`.
3. `protein` clamped to 1.4–3.0 g/kg bodyweight.
4. `fat` clamped to a floor of 0.5 g/kg (hormone health) and a ceiling of 45% of calories.
5. `carbs` recomputed as the remainder: `(calories - protein*4 - fat*9) / 4`, floored at 0.
6. Phase must be one of the four literals; anything else → fall back to local.
7. Any parse failure, missing field, non-finite number, or API error → return the
   **deterministic local recommendation** with `source: 'local'`, HTTP 200. The client
   must always get a usable answer.
8. Never let a non-finite or negative number reach the response.

**Local fallback** (also exported for client-side offline use, in
`src/utils/localRecommendation.ts`): phase from `profile.goal`; calories = anchor with
−20% for cut, +10% for lean bulk, +0% maintain; protein 2.0 g/kg (2.4 on a cut); fat
25% of calories; carbs the remainder; rate and duration from the phase.

### 1.4 Store additions (`src/store/useStore.ts`)

```ts
recommendation: Recommendation | null
recommendationSeenAt: number | null

setRecommendation(rec: Recommendation): void
acceptRecommendation(): void      // writes calories+macros into goals; keeps the rec
dismissRecommendation(): void     // sets recommendationSeenAt; does not delete
```
`acceptRecommendation` writes **only** calories/protein/carbs/fat and recomputes the
percentage fields to stay consistent with the sliders. It must not touch water, sodium,
or the user's units.

Add `'recommendation'` and `'recommendationSeenAt'` to `SYNC_FIELDS` in
`AuthContext.tsx` **and** to the `syncFields` list inside `hydrateStore`.

### 1.5 UI

`src/components/Coach/CoachPanel.tsx` — the recommendation card: phase badge, big
calorie number in `font-display`, macro row, the rationale prose, "Accept plan" and
"Refresh" buttons, a `source: 'local'` notice when offline, and the alert list.

`src/components/Coach/TdeeBreakdown.tsx` — shows predicted vs measured TDEE side by
side with the confidence label and day count, plus one line explaining the gap. This is
the trust-builder; it must be honest when data is thin.

Mounted at the top of `src/pages/Goals.tsx`, above the existing manual controls, and
surfaced as a compact summary card on the Dashboard.

**Refresh policy:** auto-call when the cached recommendation is ≥7 days old AND new
weight data exists since it was made; otherwise only on explicit Refresh. Never call on
mount unconditionally.

---

## Part 2 — Workout tracking

Strength training. The existing MET/cardio logging in Diary stays exactly as it is and
keeps feeding `caloriesBurned` — this is additive, not a replacement.

### 2.1 Types (append to `src/types/index.ts`)

```ts
export type MuscleGroup =
  | 'Chest' | 'Back' | 'Shoulders' | 'Biceps' | 'Triceps'
  | 'Quads' | 'Hamstrings' | 'Glutes' | 'Calves' | 'Core' | 'Full Body'

export type LiftEquipment =
  | 'Barbell' | 'Dumbbell' | 'Machine' | 'Cable' | 'Bodyweight' | 'Kettlebell' | 'Band'

export interface Lift {
  id: string
  name: string
  muscleGroup: MuscleGroup
  equipment: LiftEquipment
  isCompound: boolean
  isCustom?: boolean
}

export interface WorkoutSet {
  id: string
  weightKg: number        // always stored in kg; convert at the UI edge only
  reps: number
  rpe?: number            // 5-10
  isWarmup: boolean
  completed: boolean
}

export interface WorkoutExercise {
  id: string
  liftId: string
  lift: Lift              // denormalized, same pattern as FoodEntry.food
  sets: WorkoutSet[]
  notes?: string
}

export interface WorkoutSession {
  id: string
  date: string            // 'YYYY-MM-DD'
  name: string
  startedAt: number
  endedAt?: number        // undefined while in progress
  exercises: WorkoutExercise[]
  notes?: string
}

export interface WorkoutTemplate {
  id: string
  name: string
  liftIds: string[]
  createdAt: number
}

export interface PersonalRecord {
  liftId: string
  liftName: string
  bestWeightKg: number
  bestEstimated1RM: number
  bestSessionVolume: number
  achievedOn: string
}
```

### 2.2 Data — `src/data/exerciseDatabase.ts` (new file)

`LIFT_DATABASE: Lift[]` — **at least 60 lifts** with real coverage: barbell and dumbbell
compounds (squat, front squat, deadlift, RDL, bench, incline bench, OHP, row, weighted
pull-up/dip), machine and cable work, and isolation for every `MuscleGroup`. Stable
`id`s (`lift_barbell_squat`) — ids are persisted in user data and must never change.
Also export `searchLifts(query, limit)` and `getLiftById(id)`.

Keep the existing cardio `EXERCISE_DATABASE` in `foodDatabase.ts` untouched.

### 2.3 Math — `src/utils/workoutMath.ts` (pure)

- `epley1RM(weightKg, reps)` — `weight * (1 + reps/30)`; returns `weightKg` when `reps <= 1`.
- `setVolume(set)` — `weightKg * reps`; warmup sets and incomplete sets contribute 0.
- `exerciseVolume(ex)` / `sessionVolume(session)`
- `sessionSetCount(session)` — completed working sets only.
- `getLiftHistory(workoutLog, liftId)` — sessions containing that lift, newest first.
- `getPersonalRecords(workoutLog): PersonalRecord[]`
- `suggestNextSet(workoutLog, liftId, lastSet)` — progressive overload:
  if the last session hit all target reps at a given weight, suggest **+2.5 kg** for
  compounds / **+1.25 kg** for isolation; if reps fell short, suggest the same weight
  with +1 rep. Returns `null` with no history — never invent a starting weight.
- `weeklyVolumeByMuscle(workoutLog, weeks)` — for the Progress chart.

### 2.4 Store additions

```ts
workoutLog: WorkoutSession[]        // newest first
customLifts: Lift[]
workoutTemplates: WorkoutTemplate[]
activeWorkoutId: string | null

startWorkout(name: string, date: string): string     // returns the new session id
endWorkout(): void
cancelWorkout(): void                                 // discards an empty session
addExerciseToWorkout(sessionId, lift): void
removeExerciseFromWorkout(sessionId, exerciseId): void
addSet(sessionId, exerciseId, set: Omit<WorkoutSet,'id'>): void
updateSet(sessionId, exerciseId, setId, patch: Partial<WorkoutSet>): void
removeSet(sessionId, exerciseId, setId): void
deleteWorkout(sessionId): void
addCustomLift(lift: Omit<Lift,'id'|'isCustom'>): Lift
saveWorkoutTemplate(name, sessionId): void
applyWorkoutTemplate(templateId, date): string
```

Add every new key to `SYNC_FIELDS` **and** `hydrateStore`.

### 2.5 UI

- `src/pages/Workout.tsx` — history list, "Start workout", active-session banner.
- `src/components/Workout/ActiveWorkout.tsx` — the logger: exercise cards, a set grid
  (weight × reps × RPE, check-off), rest-aware add-set, live volume total, finish button.
- `src/components/Workout/LiftPicker.tsx` — search + filter by muscle group/equipment,
  create custom lift.
- `src/components/Workout/SetRow.tsx` — one editable set row; shows the
  `suggestNextSet` hint as placeholder text.
- `src/components/Workout/PRBadge.tsx` — PR celebration on a new best.

Weights display in the user's `profile.weightUnit`, but **always persist kg**. Convert
only at the input/display boundary.

---

## Part 3 — Navigation

Bottom nav becomes 5 items: **Dashboard · Diary · Workout · Progress · Profile**.

`/goals` stays a route but leaves the bottom nav — it is reached from the Dashboard
coach card and from Profile. Five is the maximum for a comfortable mobile bottom nav.

---

## Part 4 — Bugs to fix in the same pass

1. **`progressPhotos` never restores from cloud.** It is in `SYNC_FIELDS` but missing
   from the `syncFields` array inside `hydrateStore` in `src/store/useStore.ts`. Add it.
2. **Meal templates can never be created.** `saveMealTemplate` has no caller. Add a
   "Save meal as template" action to each meal section in `src/pages/Diary.tsx`.
