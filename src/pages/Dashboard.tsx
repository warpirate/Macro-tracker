import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Cookie,
  Dumbbell,
  Flame,
  Info,
  Moon,
  Plus,
  Sparkles,
  Sun,
  Sunrise,
  TrendingUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CoachAlert, PhaseType } from '../types'
import { useStore } from '../store/useStore'
import { useCoach } from '../hooks/useCoach'
import { Navbar } from '../components/Layout/Navbar'
import { MacroRing } from '../components/MacroRing'
import { MacroBar } from '../components/MacroBar'
import { WaterTracker } from '../components/WaterTracker'
import { getDayNutrition, getTodayString, formatDate } from '../utils/calculations'

/*
  Status tokens — docs/DESIGN-SYSTEM.md §2. Reserved for state, never a chart series.
  The warning and critical hexes are not in the Tailwind scale on purpose, so they are
  written as the exact documented values. Every tone ships light AND dark: `.stat-value`
  sets its color through @apply in the components layer, so `.dark .stat-value` at (0,2,0)
  would beat a bare utility at (0,1,0) — the `dark:` variant matches that specificity and
  sits in the later utilities layer, so it wins.
*/
type Tone = 'good' | 'warning' | 'critical'

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-jade-700 dark:text-jade-400',
  warning: 'text-[#B45309] dark:text-[#F59E0B]',
  critical: 'text-[#B91C1C] dark:text-[#F87171]',
}

const TONE_FILL: Record<Tone, string> = {
  good: 'bg-jade-600 dark:bg-jade-500',
  warning: 'bg-[#B45309] dark:bg-[#F59E0B]',
  critical: 'bg-[#B91C1C] dark:bg-[#F87171]',
}

const TONE_SURFACE: Record<Tone, string> = {
  good: 'border-jade-200 bg-jade-50 dark:border-jade-900 dark:bg-jade-900/20',
  warning: 'border-[#B45309]/30 bg-[#B45309]/5 dark:border-[#F59E0B]/30 dark:bg-[#F59E0B]/10',
  critical: 'border-[#B91C1C]/30 bg-[#B91C1C]/5 dark:border-[#F87171]/30 dark:bg-[#F87171]/10',
}

/** Focus ring for the full-bleed link surfaces that cannot use a .btn-* class. */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950'

/** A data number inside a sentence still wears the display face. */
const Figure: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="font-display font-semibold tabular-nums">{children}</span>
)

export const Dashboard: React.FC = () => {
  const today = getTodayString()
  const day = useStore(s => s.diary[today] ?? { date: today, entries: [], waterIntake: 0, exercises: [] })
  const goals = useStore(s => s.goals)
  const streak = useStore(s => s.streak)
  const weightLog = useStore(s => s.weightLog)
  const profile = useStore(s => s.profile)

  const nutrition = useMemo(() => getDayNutrition(day), [day])

  const mealTotals = useMemo(() => {
    const meals: Record<string, { calories: number; count: number }> = {}
    for (const entry of day.entries) {
      if (!meals[entry.mealType]) meals[entry.mealType] = { calories: 0, count: 0 }
      meals[entry.mealType].calories += entry.food.calories * entry.servings
      meals[entry.mealType].count++
    }
    return meals
  }, [day])

  const caloriePct = Math.round((nutrition.calories / goals.calories) * 100)
  const latestWeight = weightLog[0]

  const barPct = Math.min(Math.max((nutrition.calories / Math.max(goals.calories, 1)) * 100, 0), 100)
  const remaining = goals.calories - nutrition.calories
  const netRemaining = goals.calories - nutrition.netCalories
  const netOver = nutrition.netCalories > goals.calories

  const calorieTone: Tone = caloriePct >= 100 ? 'critical' : caloriePct >= 90 ? 'warning' : 'good'
  const CalorieIcon = calorieTone === 'good' ? Check : AlertTriangle

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <Navbar
        subtitle={formatDate(today) + ' · ' + new Date().toLocaleDateString('en-US', { weekday: 'long' })}
      />

      <div className="page-container space-y-4">

        {/* --- Hero: the one number the screen exists for ------------------- */}
        <section className="card p-5" aria-label="Calories today">
          <div className="flex items-start justify-between gap-3">
            <p className="stat-label">Eaten today</p>
            <Link
              to="/diary"
              className={`-mr-1 -mt-1 inline-flex items-center gap-1 rounded-xl px-1 py-1 text-sm font-semibold text-jade-700 transition-colors duration-150 hover:text-jade-800 dark:text-jade-400 dark:hover:text-jade-300 ${FOCUS_RING}`}
            >
              View diary
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <p className="stat-value text-5xl leading-none sm:text-6xl">
              {Math.round(nutrition.calories).toLocaleString()}
            </p>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              / <Figure>{goals.calories.toLocaleString()}</Figure> kcal
            </p>
          </div>

          <div
            className="mt-4 h-2.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(barPct)}
            aria-label="Share of your daily calorie goal eaten"
          >
            <div
              className={`progress-bar-fill h-full rounded-full ${TONE_FILL[calorieTone]}`}
              style={{ width: `${barPct}%` }}
            />
          </div>

          <p className={`mt-2.5 flex items-center gap-1.5 text-sm font-semibold ${TONE_TEXT[calorieTone]}`}>
            <CalorieIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {remaining > 0 ? (
              <span>
                <Figure>{Math.round(remaining).toLocaleString()}</Figure> kcal left today
              </span>
            ) : (
              <span>
                <Figure>{Math.round(Math.abs(remaining)).toLocaleString()}</Figure> kcal over your goal
              </span>
            )}
          </p>

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
            <StatBox label="Goal" value={goals.calories} unit="kcal" />
            <StatBox label="Burned" value={nutrition.caloriesBurned} unit="kcal" />
            <StatBox
              label="Net"
              value={nutrition.netCalories}
              unit="kcal"
              tone={netOver ? 'critical' : undefined}
              overLabel="over goal"
            />
          </div>

          {nutrition.caloriesBurned > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-stone-500 dark:text-stone-500">
              {netRemaining > 0 ? (
                <>
                  Net of exercise, <Figure>{Math.round(netRemaining).toLocaleString()}</Figure> kcal left.
                </>
              ) : (
                <>
                  Net of exercise, <Figure>{Math.round(Math.abs(netRemaining)).toLocaleString()}</Figure>{' '}
                  kcal over budget.
                </>
              )}
            </p>
          )}
        </section>

        {/* --- Coach summary ------------------------------------------------ */}
        <CoachSummaryCard />

        {/* --- Macros ------------------------------------------------------- */}
        <section className="card p-5" aria-label="Macronutrients">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="section-title mb-0">Macros</h2>
            <Link
              to="/goals"
              className={`-mr-1 inline-flex items-center gap-1 rounded-xl px-1 py-1 text-sm font-semibold text-jade-700 transition-colors duration-150 hover:text-jade-800 dark:text-jade-400 dark:hover:text-jade-300 ${FOCUS_RING}`}
            >
              Adjust targets
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
            <div className="shrink-0">
              <MacroRing
                calories={nutrition.calories}
                goal={goals.calories}
                protein={nutrition.protein}
                carbs={nutrition.carbs}
                fat={nutrition.fat}
                size={160}
              />
            </div>

            <div className="w-full flex-1 space-y-3">
              <MacroBar
                label="Protein"
                current={nutrition.protein}
                goal={goals.protein}
                color="text-macro-protein"
                bgColor="bg-macro-protein"
              />
              <MacroBar
                label="Carbohydrates"
                current={nutrition.carbs}
                goal={goals.carbs}
                color="text-macro-carbs"
                bgColor="bg-macro-carbs"
              />
              <MacroBar
                label="Fat"
                current={nutrition.fat}
                goal={goals.fat}
                color="text-macro-fat"
                bgColor="bg-macro-fat"
              />
              <MacroBar
                label="Fiber"
                current={nutrition.fiber}
                goal={goals.fiber}
                color="text-macro-fiber"
                bgColor="bg-macro-fiber"
              />
            </div>
          </div>
        </section>

        {/* --- Meals -------------------------------------------------------- */}
        <section className="card p-5" aria-label="Meals">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="section-title mb-0">Meals</h2>
            <Link to="/diary" className="btn-primary px-3 text-sm">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add food
            </Link>
          </div>

          {(['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const).map(meal => {
            const data = mealTotals[meal]
            const MealIcon = MEAL_ICONS[meal]
            return (
              <Link
                key={meal}
                to={`/diary?meal=${meal}`}
                className={`-mx-2 flex items-center gap-3 rounded-xl border-b border-stone-200 px-2 py-3 transition-colors duration-150 last:border-0 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/60 ${FOCUS_RING}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800">
                  <MealIcon className="h-5 w-5 text-stone-600 dark:text-stone-400" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {meal}
                  </span>
                  <span className="block text-xs text-stone-500 dark:text-stone-500">
                    {data ? (
                      <>
                        <Figure>{data.count}</Figure> item{data.count !== 1 ? 's' : ''}
                      </>
                    ) : (
                      'Nothing logged'
                    )}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {data ? (
                    <span className="font-display font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                      {Math.round(data.calories).toLocaleString()}
                      <span className="ml-1 font-sans text-xs font-medium text-stone-500">kcal</span>
                    </span>
                  ) : (
                    <span className="text-sm text-stone-400 dark:text-stone-600" aria-hidden="true">
                      —
                    </span>
                  )}
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-600"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            )
          })}
        </section>

        {/* --- Water -------------------------------------------------------- */}
        <WaterTracker date={today} />

        {/* --- At a glance --------------------------------------------------- */}
        <div className="grid grid-cols-3 gap-3">
          <GlanceStat
            icon={Flame}
            iconClass="text-amber-700 dark:text-amber-500"
            value={streak.current.toLocaleString()}
            label="Day streak"
          />
          <GlanceStat
            icon={Dumbbell}
            iconClass="text-stone-500 dark:text-stone-400"
            value={Math.round(nutrition.caloriesBurned).toLocaleString()}
            label="Cal burned"
          />
          <GlanceStat
            icon={TrendingUp}
            iconClass="text-stone-500 dark:text-stone-400"
            value={latestWeight ? `${latestWeight.weight}` : '—'}
            label={profile.weightUnit}
          />
        </div>

        {/* --- Micronutrients ------------------------------------------------ */}
        <section className="card p-5" aria-label="Micronutrients">
          <h2 className="section-title">Micronutrients</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <MicroRow label="Sodium" current={nutrition.sodium} goal={goals.sodium} unit="mg" />
            <MicroRow label="Potassium" current={nutrition.potassium} goal={4700} unit="mg" />
            <MicroRow label="Sugar" current={nutrition.sugar} goal={goals.sugar} unit="g" />
            <MicroRow label="Cholesterol" current={nutrition.cholesterol} goal={300} unit="mg" />
            <MicroRow label="Vitamin A" current={nutrition.vitaminA} goal={100} unit="%" />
            <MicroRow label="Vitamin C" current={nutrition.vitaminC} goal={100} unit="%" />
            <MicroRow label="Calcium" current={nutrition.calcium} goal={100} unit="%" />
            <MicroRow label="Iron" current={nutrition.iron} goal={100} unit="%" />
          </div>
        </section>

        {/* --- Calorie budget notice ------------------------------------------ */}
        {caloriePct >= 90 && (
          <div
            className={`flex items-start gap-3 rounded-2xl border p-4 ${
              caloriePct >= 100 ? TONE_SURFACE.critical : TONE_SURFACE.warning
            }`}
          >
            <AlertTriangle
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                caloriePct >= 100 ? TONE_TEXT.critical : TONE_TEXT.warning
              }`}
              aria-hidden="true"
            />
            <p
              className={`text-sm font-medium leading-relaxed ${
                caloriePct >= 100 ? TONE_TEXT.critical : TONE_TEXT.warning
              }`}
            >
              <span className="sr-only">{caloriePct >= 100 ? 'Over budget: ' : 'Warning: '}</span>
              {caloriePct >= 100 ? (
                <>
                  You&apos;ve exceeded your calorie goal by{' '}
                  <Figure>{Math.round(nutrition.calories - goals.calories).toLocaleString()}</Figure> kcal
                  today.
                </>
              ) : (
                <>
                  You&apos;re at <Figure>{caloriePct}</Figure>% of your calorie goal.{' '}
                  <Figure>{Math.round(goals.calories - nutrition.calories).toLocaleString()}</Figure> kcal
                  remaining.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

const MEAL_ICONS: Record<string, LucideIcon> = {
  Breakfast: Sunrise,
  Lunch: Sun,
  Dinner: Moon,
  Snacks: Cookie,
}

const PHASE_LABELS: Record<PhaseType, string> = {
  cut: 'Cut',
  lean_bulk: 'Lean bulk',
  maintain: 'Maintain',
  recomp: 'Recomp',
}

/**
 * Compact read-only view of the coach's plan, linking through to /goals for the full
 * panel. With no plan it prompts for one rather than inventing a placeholder number.
 */
const CoachSummaryCard: React.FC = () => {
  const { recommendation, alerts } = useCoach()

  // getCoachAlerts already sorts warnings first; re-picking here keeps this correct even
  // if that ever changes.
  const topAlert: CoachAlert | null = useMemo(() => {
    const warning = alerts.find(alert => alert.severity === 'warning')
    if (warning) return warning
    return alerts.length > 0 ? alerts[0] : null
  }, [alerts])

  const cardClass = `card block p-4 transition-colors duration-150 hover:border-stone-300 dark:hover:border-stone-700 ${FOCUS_RING}`

  if (!recommendation) {
    return (
      <Link to="/goals" className={cardClass}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jade-50 dark:bg-jade-900/30">
            <Sparkles className="h-5 w-5 text-jade-700 dark:text-jade-400" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="stat-label">Coach</p>
            <p className="mt-1 text-sm leading-snug text-stone-600 dark:text-stone-400">
              No plan yet — set up a phase and calorie target built from your own data.
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true" />
        </div>
      </Link>
    )
  }

  return (
    <Link to="/goals" className={cardClass}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jade-50 dark:bg-jade-900/30">
          <Sparkles className="h-5 w-5 text-jade-700 dark:text-jade-400" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="stat-label">Coach plan</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-stone-600 dark:text-stone-400">
            <span className="font-display text-base font-semibold text-stone-900 dark:text-stone-100">
              {PHASE_LABELS[recommendation.phase]}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <Figure>{Math.round(recommendation.calories).toLocaleString()}</Figure> kcal/day
            </span>
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true" />
      </div>

      {topAlert && (
        <p
          className={`mt-3 flex items-start gap-2 border-t border-stone-200 pt-3 text-sm font-medium dark:border-stone-800 ${
            topAlert.severity === 'warning' ? TONE_TEXT.warning : 'text-stone-600 dark:text-stone-400'
          }`}
        >
          {topAlert.severity === 'warning' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            <span className="sr-only">{topAlert.severity === 'warning' ? 'Warning: ' : 'Note: '}</span>
            {topAlert.title}
          </span>
        </p>
      )}
    </Link>
  )
}

const StatBox: React.FC<{
  label: string
  value: number
  unit: string
  tone?: Tone
  /** Screen-reader wording for the tone, so the state never rides on color alone. */
  overLabel?: string
}> = ({ label, value, unit, tone, overLabel }) => (
  <div className="text-center">
    <p className="stat-label">{label}</p>
    <p className={`stat-value mt-1 text-xl ${tone ? TONE_TEXT[tone] : ''}`}>
      {tone === 'critical' && (
        <>
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{overLabel ?? 'over target'}: </span>
        </>
      )}
      {Math.round(value).toLocaleString()}
    </p>
    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-500">{unit}</p>
  </div>
)

const GlanceStat: React.FC<{
  icon: LucideIcon
  iconClass: string
  value: string
  label: string
}> = ({ icon: Icon, iconClass, value, label }) => (
  <div className="card p-3 text-center">
    <Icon className={`mx-auto mb-1.5 h-5 w-5 ${iconClass}`} aria-hidden="true" />
    <p className="stat-value text-xl">{value}</p>
    <p className="stat-label mt-0.5">{label}</p>
  </div>
)

/*
  Micronutrients are not part of the categorical macro palette — sugar and sodium
  especially must never borrow a macro hue — so every bar is neutral stone. Going over
  the target is a status, carried by an icon and a screen-reader label as well as color.
*/
const MicroRow: React.FC<{ label: string; current: number; goal: number; unit: string }> = ({ label, current, goal, unit }) => {
  const pct = Math.min((current / Math.max(goal, 1)) * 100, 100)
  const isOver = current > goal
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-stone-600 dark:text-stone-400">{label}</span>
        <span
          className={`inline-flex items-center gap-1 font-display font-semibold tabular-nums ${
            isOver ? TONE_TEXT.critical : 'text-stone-900 dark:text-stone-100'
          }`}
        >
          {isOver && (
            <>
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="sr-only">over target: </span>
            </>
          )}
          {current >= 10 ? Math.round(current) : current.toFixed(1)}
          <span className="font-sans font-medium text-stone-500">{unit}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div
          className={`progress-bar-fill h-full rounded-full ${
            isOver ? TONE_FILL.critical : 'bg-stone-400 dark:bg-stone-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
