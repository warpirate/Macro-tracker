import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Minus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { Navbar } from '../components/Layout/Navbar'
import { CoachPanel } from '../components/Coach/CoachPanel'
import { TdeeBreakdown } from '../components/Coach/TdeeBreakdown'
import { calculateBMR, calculateTDEE, calculateCalorieGoal } from '../utils/calculations'

type Tab = 'calories' | 'macros' | 'other'

const TABS: { id: Tab; label: string }[] = [
  { id: 'calories', label: 'Calories' },
  { id: 'macros', label: 'Macros' },
  { id: 'other', label: 'Limits' },
]

/*
  Status tokens from docs/DESIGN-SYSTEM.md §2. The warning pair (#B45309 light /
  #F59E0B dark) sits outside the Tailwind scale on purpose — it must never be reusable
  as a chart series — so the documented hex values are written out here. Status is
  always carried by an icon and words as well as by color.
*/
const WARNING_PILL =
  'border-[#B45309]/30 bg-[#B45309]/5 text-[#B45309] dark:border-[#F59E0B]/30 dark:bg-[#F59E0B]/10 dark:text-[#F59E0B]'
const GOOD_PILL =
  'border-jade-600/30 bg-jade-50 text-jade-700 dark:border-jade-400/30 dark:bg-jade-400/10 dark:text-jade-400'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950'

/** Neutral card-level subhead. Display face, one step under `.section-title`. */
const CardHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="font-display text-base font-semibold tracking-tight text-stone-900 dark:text-stone-100">
    {children}
  </h3>
)

/** A read-only figure cell: label above, display numeral below. */
const FigureCell: React.FC<{ label: string; value: number; caption: string }> = ({
  label,
  value,
  caption,
}) => (
  <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
    <p className="stat-label">{label}</p>
    <p className="stat-value mt-1.5 text-xl">{value.toLocaleString()}</p>
    <p className="mt-1 text-xs text-stone-500 dark:text-stone-500">{caption}</p>
  </div>
)

export const Goals: React.FC = () => {
  const goals = useStore(s => s.goals)
  const profile = useStore(s => s.profile)
  const currentWeightKg = useStore(s => s.currentWeightKg)
  const updateGoals = useStore(s => s.updateGoals)
  const recalculateGoals = useStore(s => s.recalculateGoals)

  const [activeTab, setActiveTab] = useState<Tab>('calories')
  const [local, setLocal] = useState({ ...goals })
  const [saved, setSaved] = useState(false)

  /*
    The manual form is seeded from the saved goals, so it has to re-seed whenever those
    goals change underneath it — accepting a coach plan writes calories, macros and the
    split percentages straight into the store. Without this, Save would quietly revert a
    plan the user had just accepted a few centimetres up the page. Goals only ever change
    through an explicit action (Save, Recalculate, Accept), so no in-progress edit is lost.
  */
  const lastGoalsRef = useRef(goals)
  useEffect(() => {
    if (lastGoalsRef.current === goals) return
    lastGoalsRef.current = goals
    setLocal({ ...goals })
  }, [goals])

  const bmr = calculateBMR(profile, currentWeightKg)
  const tdee = calculateTDEE(bmr, profile.activityLevel)
  const suggestedCalories = calculateCalorieGoal(tdee, profile.goal)

  const totalPct = local.proteinPct + local.carbsPct + local.fatPct
  const splitBalanced = totalPct === 100

  const handleSave = () => {
    updateGoals(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleRecalculate = () => {
    recalculateGoals()
    setLocal({ ...goals })
  }

  const updateMacroPct = (macro: 'proteinPct' | 'carbsPct' | 'fatPct', value: number) => {
    const next = { ...local, [macro]: value }
    // Auto-calculate grams from calories
    next.protein = Math.round((next.calories * next.proteinPct) / 400)
    next.carbs = Math.round((next.calories * next.carbsPct) / 400)
    next.fat = Math.round((next.calories * next.fatPct) / 900)
    setLocal(next)
  }

  const updateCalories = (calories: number) => {
    const next = {
      ...local,
      calories,
      protein: Math.round((calories * local.proteinPct) / 400),
      carbs: Math.round((calories * local.carbsPct) / 400),
      fat: Math.round((calories * local.fatPct) / 900),
    }
    setLocal(next)
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <Navbar title="Goals & Targets" subtitle="Your coach plan and your manual numbers" />

      <div className="page-container space-y-5">
        <Link to="/" className={`btn-ghost -ml-3 px-3 text-sm ${FOCUS_RING}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>

        {/* ---------------------------------------------------------------- */}
        {/* Your plan — what the coach recommends                            */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="plan-heading" className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles
                className="h-4 w-4 shrink-0 text-jade-700 dark:text-jade-400"
                aria-hidden="true"
              />
              <h2 id="plan-heading" className="section-title mb-0">
                Your plan
              </h2>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              Built from your weigh-ins, what you have actually logged and your measurements.
              Nothing here touches your daily targets until you accept it.
            </p>
          </div>

          {/* Alerts are rendered by CoachPanel itself; mounting them here too would
              show every alert twice on this page. */}
          <CoachPanel />
          <TdeeBreakdown />
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Manual overrides — the user always has the last word              */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="manual-heading" className="space-y-4">
          <div className="border-t border-stone-200 pt-6 dark:border-stone-800">
            <div className="flex items-center gap-2">
              <SlidersHorizontal
                className="h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400"
                aria-hidden="true"
              />
              <h2 id="manual-heading" className="section-title mb-0">
                Manual overrides
              </h2>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              The coach only ever recommends. Set anything you like here and press Save — your
              numbers win until you accept a new plan.
            </p>
          </div>

          {/* Formula reference — the numbers behind Recalculate */}
          <div className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardHeading>Formula reference</CardHeading>
              <button
                type="button"
                onClick={handleRecalculate}
                className={`btn-ghost -my-1 px-2 text-sm ${FOCUS_RING}`}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Recalculate from profile
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3">
              <FigureCell label="BMR" value={Math.round(bmr)} caption="kcal at rest" />
              <FigureCell label="TDEE" value={tdee} caption="kcal you burn" />
              <FigureCell
                label="Suggested"
                value={suggestedCalories}
                caption={`kcal to ${profile.goal}`}
              />
            </div>

            <p className="mt-3 text-xs leading-relaxed text-stone-500 dark:text-stone-500">
              Straight from your age, height, weight and activity level. The coach&apos;s burn
              estimate above also folds in what you have logged, so the two can differ.
            </p>
          </div>

          {/* Section selector */}
          <div
            className="card-flush flex gap-1 p-1"
            role="group"
            aria-label="Choose which targets to edit"
          >
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-pressed={activeTab === id}
                className={`min-h-[44px] flex-1 rounded-xl px-3 text-sm font-semibold transition-colors duration-150 ${FOCUS_RING} ${
                  activeTab === id
                    ? 'bg-jade-600 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Calories tab */}
          {activeTab === 'calories' && (
            <div className="space-y-4">
              <div className="card p-4">
                <label htmlFor="calorie-goal" className="label-text">
                  Daily calorie goal
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1000}
                    max={5000}
                    step={50}
                    value={local.calories}
                    onChange={e => updateCalories(Number(e.target.value))}
                    aria-label="Daily calorie goal slider"
                    className={`h-11 flex-1 cursor-pointer accent-jade-600 dark:accent-jade-400 ${FOCUS_RING}`}
                  />
                  <input
                    id="calorie-goal"
                    type="number"
                    value={local.calories}
                    onChange={e => updateCalories(Number(e.target.value))}
                    className="input-field w-24 px-2 text-center font-display text-lg font-semibold tabular-nums"
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs tabular-nums text-stone-500 dark:text-stone-500">
                  <span>1,000</span>
                  <span>kcal</span>
                  <span>5,000</span>
                </div>
              </div>

              {/* Goal presets */}
              <div className="card p-4">
                <CardHeading>Quick presets</CardHeading>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  Anchored to your{' '}
                  <span className="font-display font-semibold tabular-nums">
                    {tdee.toLocaleString()}
                  </span>{' '}
                  kcal formula burn.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Cut', delta: -500, Icon: TrendingDown },
                    { label: 'Maintain', delta: 0, Icon: Minus },
                    { label: 'Bulk', delta: 300, Icon: TrendingUp },
                  ].map(({ label, delta, Icon }) => {
                    const value = Math.max(1000, tdee + delta)
                    const active = local.calories === value
                    const deltaText = delta === 0 ? 'at TDEE' : `${delta > 0 ? '+' : ''}${delta}`

                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => updateCalories(value)}
                        aria-pressed={active}
                        className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl border p-2.5 transition-colors duration-150 ${FOCUS_RING} ${
                          active
                            ? 'border-jade-600 bg-jade-50 dark:border-jade-400 dark:bg-jade-400/10'
                            : 'border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800'
                        }`}
                      >
                        <span className="font-display text-lg font-semibold tabular-nums leading-tight text-stone-900 dark:text-stone-100">
                          {value.toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1 text-xs font-semibold text-stone-700 dark:text-stone-300">
                          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {label}
                        </span>
                        <span className="text-xs tabular-nums text-stone-500 dark:text-stone-500">
                          {deltaText}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Macros tab */}
          {activeTab === 'macros' && (
            <div className="space-y-4">
              <div className="card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <CardHeading>Macro split</CardHeading>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums ${
                      splitBalanced ? GOOD_PILL : WARNING_PILL
                    }`}
                  >
                    {splitBalanced ? (
                      <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="sr-only">{splitBalanced ? 'Balanced: ' : 'Warning: '}</span>
                    {totalPct}% total
                  </span>
                </div>

                {/* Visual macro bar — color follows the macro, and every band is
                    directly labelled in the rows underneath. */}
                <div
                  className="mb-4 flex h-3 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
                  role="img"
                  aria-label={`Macro split: protein ${local.proteinPct} percent, carbs ${local.carbsPct} percent, fat ${local.fatPct} percent`}
                >
                  <div
                    className="bg-macro-protein transition-all duration-300"
                    style={{ width: `${local.proteinPct}%` }}
                  />
                  <div
                    className="bg-macro-carbs transition-all duration-300"
                    style={{ width: `${local.carbsPct}%` }}
                  />
                  <div
                    className="bg-macro-fat transition-all duration-300"
                    style={{ width: `${local.fatPct}%` }}
                  />
                </div>

                {!splitBalanced && (
                  <p className="-mt-2 mb-4 text-xs leading-relaxed text-[#B45309] dark:text-[#F59E0B]">
                    Protein, carbs and fat should add up to 100%. Yours add up to {totalPct}%.
                  </p>
                )}

                {[
                  {
                    key: 'proteinPct' as const,
                    label: 'Protein',
                    accent: 'accent-macro-protein',
                    dot: 'bg-macro-protein',
                    gram: local.protein,
                  },
                  {
                    key: 'carbsPct' as const,
                    label: 'Carbs',
                    accent: 'accent-macro-carbs',
                    dot: 'bg-macro-carbs',
                    gram: local.carbs,
                  },
                  {
                    key: 'fatPct' as const,
                    label: 'Fat',
                    accent: 'accent-macro-fat',
                    dot: 'bg-macro-fat',
                    gram: local.fat,
                  },
                ].map(({ key, label, accent, dot, gram }) => (
                  <div key={key} className="mb-4 last:mb-0">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${dot}`}
                          aria-hidden="true"
                        />
                        {label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-display text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                          {gram}
                          <span className="ml-0.5 font-sans text-xs font-medium text-stone-500">
                            g
                          </span>
                        </span>
                        <input
                          type="number"
                          value={local[key]}
                          onChange={e =>
                            updateMacroPct(key, Math.min(100, Math.max(0, Number(e.target.value))))
                          }
                          aria-label={`${label} percentage`}
                          className="input-field w-16 px-1 text-center font-display text-sm font-semibold tabular-nums"
                          min={0}
                          max={100}
                        />
                        <span className="text-xs text-stone-500 dark:text-stone-500">%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={70}
                      value={local[key]}
                      onChange={e => updateMacroPct(key, Number(e.target.value))}
                      aria-label={`${label} percentage slider`}
                      className={`h-11 w-full cursor-pointer ${accent} ${FOCUS_RING}`}
                    />
                  </div>
                ))}

                {/* Preset splits */}
                <div className="mt-4 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <p className="label-text">Common splits</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Balanced', p: 30, c: 40, f: 30 },
                      { label: 'Low Carb', p: 35, c: 25, f: 40 },
                      { label: 'High Protein', p: 40, c: 35, f: 25 },
                      { label: 'Keto', p: 25, c: 5, f: 70 },
                    ].map(s => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          const next = { ...local, proteinPct: s.p, carbsPct: s.c, fatPct: s.f }
                          next.protein = Math.round((next.calories * s.p) / 400)
                          next.carbs = Math.round((next.calories * s.c) / 400)
                          next.fat = Math.round((next.calories * s.f) / 900)
                          setLocal(next)
                        }}
                        className={`flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors duration-150 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 ${FOCUS_RING}`}
                      >
                        <span>{s.label}</span>
                        <span className="font-display text-xs font-semibold tabular-nums text-stone-500 dark:text-stone-500">
                          {s.p}/{s.c}/{s.f}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Manual gram targets */}
              <div className="card p-4">
                <CardHeading>Manual gram targets</CardHeading>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  Set grams directly when a split percentage will not land where you want it.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {[
                    { key: 'protein' as const, label: 'Protein', dot: 'bg-macro-protein' },
                    { key: 'carbs' as const, label: 'Carbs', dot: 'bg-macro-carbs' },
                    { key: 'fat' as const, label: 'Fat', dot: 'bg-macro-fat' },
                    { key: 'fiber' as const, label: 'Fiber', dot: 'bg-macro-fiber' },
                  ].map(({ key, label, dot }) => (
                    <div key={key}>
                      <label htmlFor={`gram-${key}`} className="label-text flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${dot}`}
                          aria-hidden="true"
                        />
                        {label} (g)
                      </label>
                      <input
                        id={`gram-${key}`}
                        type="number"
                        value={local[key]}
                        onChange={e => setLocal(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="input-field text-center font-display font-semibold tabular-nums"
                        min={0}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Other tab */}
          {activeTab === 'other' && (
            <div className="space-y-4">
              <div className="card space-y-5 p-4">
                <div>
                  <CardHeading>Water and limits</CardHeading>
                  <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                    Sodium and sugar are ceilings, not targets — you are on track when the day
                    finishes under them.
                  </p>
                </div>
                <NumberGoalRow
                  id="goal-water"
                  label="Water goal (ml)"
                  value={local.water}
                  onChange={v => setLocal(p => ({ ...p, water: v }))}
                  min={500}
                  max={6000}
                  step={100}
                />
                <NumberGoalRow
                  id="goal-sodium"
                  label="Sodium limit (mg)"
                  value={local.sodium}
                  onChange={v => setLocal(p => ({ ...p, sodium: v }))}
                  min={500}
                  max={5000}
                  step={100}
                />
                <NumberGoalRow
                  id="goal-sugar"
                  label="Sugar limit (g)"
                  value={local.sugar}
                  onChange={v => setLocal(p => ({ ...p, sugar: v }))}
                  min={10}
                  max={150}
                  step={5}
                />
              </div>
            </div>
          )}

          {/* Save button */}
          <div>
            <button
              onClick={handleSave}
              className={`btn-primary w-full ${saved ? 'bg-jade-700 hover:bg-jade-700' : ''}`}
            >
              {saved ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {saved ? 'Saved' : 'Save goals'}
            </button>
            <p className="mt-2 text-center text-xs text-stone-500 dark:text-stone-500">
              Saving replaces your daily targets with the numbers above.
            </p>
            <p aria-live="polite" className="sr-only">
              {saved ? 'Goals saved' : ''}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

const NumberGoalRow: React.FC<{
  id: string; label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number
}> = ({ id, label, value, onChange, min, max, step }) => (
  <div>
    <div className="mb-1 flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="input-field w-24 px-2 text-center font-display text-sm font-semibold tabular-nums"
        min={min} max={max} step={step}
      />
    </div>
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      aria-label={`${label} slider`}
      className={`h-11 w-full cursor-pointer accent-jade-600 dark:accent-jade-400 ${FOCUS_RING}`}
    />
    <div className="flex justify-between text-xs tabular-nums text-stone-500 dark:text-stone-500">
      <span>{min.toLocaleString()}</span>
      <span>{max.toLocaleString()}</span>
    </div>
  </div>
)
