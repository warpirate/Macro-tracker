import React, { useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  Flame,
  NotebookPen,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import {
  ACTIVITY_CHOICES,
  GOAL_CHOICES,
  answersToProfile,
  cmFromFeetInches,
  describeHorizon,
  defaultPaceFor,
  feetInchesFromCm,
  kgFromLbs,
  lbsFromKg,
  pacesFor,
  validateBasics,
  validateTarget,
  weeksToTarget,
} from '../utils/onboarding'
import { calculateBMR, calculateCalorieGoal, calculateMacroGoals, calculateTDEE } from '../utils/calculations'
import type { ActivityLevel, UserProfile, WeightGoal } from '../types'

/** The five stops, in order. The labels are what the rail shows. */
const STEPS = ['Welcome', 'About you', 'Your days', 'Your goal', 'Your plan'] as const

/** A tappable option row. The whole row is the target, not just a small radio. */
const OptionRow: React.FC<{
  label: string
  detail?: string
  selected: boolean
  onSelect: () => void
}> = ({ label, detail, selected, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 ${
      selected
        ? 'border-jade-600 bg-jade-50 dark:border-jade-400/60 dark:bg-jade-900/25'
        : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700'
    }`}
  >
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        selected
          ? 'border-jade-600 bg-jade-600 dark:border-jade-400 dark:bg-jade-400'
          : 'border-stone-300 dark:border-stone-600'
      }`}
    >
      {selected && <Check className="h-3 w-3 text-white dark:text-stone-950" strokeWidth={3} />}
    </span>
    <span className="min-w-0">
      <span
        className={`block text-sm font-semibold ${
          selected ? 'text-jade-800 dark:text-jade-200' : 'text-stone-900 dark:text-stone-100'
        }`}
      >
        {label}
      </span>
      {detail && (
        <span className="mt-0.5 block text-sm leading-snug text-stone-600 dark:text-stone-400">
          {detail}
        </span>
      )}
    </span>
  </button>
)

/** Two-value unit switch, small enough to sit beside the field it governs. */
const UnitToggle = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (next: T) => void
  label: string
}) => (
  <div
    role="group"
    aria-label={label}
    className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 dark:border-stone-800 dark:bg-stone-800/60"
  >
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 ${
          value === o.value
            ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100 dark:shadow-none'
            : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
)

const FieldShell: React.FC<{
  label: string
  htmlFor?: string
  aside?: React.ReactNode
  children: React.ReactNode
}> = ({ label, htmlFor, aside, children }) => (
  <div>
    <div className="mb-1.5 flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="label-text mb-0">
        {label}
      </label>
      {aside}
    </div>
    {children}
  </div>
)

/**
 * First-run setup.
 *
 * Runs once per account, before the app proper, because every number the app shows is
 * derived from height, weight, age and activity — and the store's defaults describe a
 * 30-year-old 175 cm male. Skipping this does not leave the app empty, it leaves it
 * confidently wrong, which is worse.
 */
export const OnboardingPage: React.FC = () => {
  const profile = useStore(s => s.profile)
  const currentWeightKg = useStore(s => s.currentWeightKg)
  const goals = useStore(s => s.goals)
  const updateProfile = useStore(s => s.updateProfile)
  const addWeightEntry = useStore(s => s.addWeightEntry)
  const recalculateGoals = useStore(s => s.recalculateGoals)
  const completeOnboarding = useStore(s => s.completeOnboarding)

  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [gender, setGender] = useState<UserProfile['gender']>(profile.gender)
  const [age, setAge] = useState('')
  const [heightUnit, setHeightUnit] = useState<UserProfile['heightUnit']>(profile.heightUnit)
  const [heightCmText, setHeightCmText] = useState('')
  const [heightFt, setHeightFt] = useState('')
  const [heightIn, setHeightIn] = useState('')
  const [weightUnit, setWeightUnit] = useState<UserProfile['weightUnit']>(profile.weightUnit)
  const [weightText, setWeightText] = useState('')
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('lightly_active')
  const [goal, setGoal] = useState<WeightGoal>('lose')
  const [pace, setPace] = useState<number | undefined>(defaultPaceFor('lose'))
  const [targetText, setTargetText] = useState('')

  const num = (text: string): number => Number.parseFloat(text.replace(',', '.'))

  const heightCm = heightUnit === 'cm' ? num(heightCmText) : cmFromFeetInches(num(heightFt) || 0, num(heightIn) || 0)
  const weightKg = weightUnit === 'kg' ? num(weightText) : kgFromLbs(num(weightText))
  const targetKg = targetText.trim() === ''
    ? undefined
    : weightUnit === 'kg'
      ? num(targetText)
      : kgFromLbs(num(targetText))

  /** Switching units rewrites the field so the number on screen stays the same body. */
  const switchWeightUnit = (next: UserProfile['weightUnit']) => {
    if (next === weightUnit) return
    const convert = (text: string): string => {
      const value = num(text)
      if (!Number.isFinite(value)) return text
      const converted = next === 'kg' ? kgFromLbs(value) : lbsFromKg(value)
      return String(Math.round(converted * 10) / 10)
    }
    setWeightText(convert(weightText))
    if (targetText.trim() !== '') setTargetText(convert(targetText))
    setWeightUnit(next)
  }

  const switchHeightUnit = (next: UserProfile['heightUnit']) => {
    if (next === heightUnit) return
    if (next === 'ft') {
      const cm = num(heightCmText)
      if (Number.isFinite(cm)) {
        const { feet, inches } = feetInchesFromCm(cm)
        setHeightFt(String(feet))
        setHeightIn(String(inches))
      }
    } else {
      const cm = cmFromFeetInches(num(heightFt) || 0, num(heightIn) || 0)
      if (cm > 0) setHeightCmText(String(Math.round(cm)))
    }
    setHeightUnit(next)
  }

  const answers = {
    name,
    gender,
    age: num(age),
    heightCm,
    weightKg,
    weightUnit,
    heightUnit,
    activityLevel,
    goal,
    paceKgPerWeek: pace,
    targetWeightKg: targetKg,
  }

  // The plan preview runs the same functions the store runs on save, so what the last
  // step promises is exactly what lands in the app.
  const plan = useMemo(() => {
    const preview: UserProfile = { ...profile, ...answersToProfile(answers) } as UserProfile
    const kg = Number.isFinite(weightKg) ? weightKg : currentWeightKg
    const bmr = calculateBMR(preview, kg)
    const tdee = calculateTDEE(bmr, activityLevel)
    const calories = calculateCalorieGoal(tdee, goal)
    const macros = calculateMacroGoals(calories, goals.proteinPct, goals.carbsPct, goals.fatPct, kg)
    return { tdee: Math.round(tdee), ...macros }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightKg, heightCm, age, gender, activityLevel, goal, pace, targetKg])

  const horizon = describeHorizon(weeksToTarget(weightKg, targetKg, pace))

  const validateStep = (index: number): string | null => {
    if (index === 1) return validateBasics({ age: num(age), heightCm, weightKg })
    if (index === 3) return validateTarget(goal, weightKg, targetKg)
    return null
  }

  const next = () => {
    const problem = validateStep(step)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    if (step < STEPS.length - 1) setStep(step + 1)
    else finish()
  }

  const back = () => {
    setError(null)
    setStep(s => Math.max(0, s - 1))
  }

  const finish = () => {
    // Profile first: addWeightEntry reads weightUnit off the profile to decide what the
    // number it is handed means.
    updateProfile(answersToProfile(answers))
    const shown = weightUnit === 'kg' ? weightKg : lbsFromKg(weightKg)
    addWeightEntry({ date: new Date().toISOString().slice(0, 10), weight: Math.round(shown * 10) / 10 })
    recalculateGoals()
    completeOnboarding()
  }

  const changeGoal = (next: WeightGoal) => {
    setGoal(next)
    setPace(defaultPaceFor(next))
    setError(null)
  }

  const weightSuffix = weightUnit === 'kg' ? 'kg' : 'lbs'

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-50 px-4 py-10 dark:bg-stone-950 sm:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-16rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-jade-200/50 blur-3xl dark:bg-jade-800/25" />
        <div className="absolute bottom-[-18rem] left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-stone-200/70 blur-3xl dark:bg-stone-800/40" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Progress rail: filled segments, and only the current stop is named. Naming all
            five turns a one-minute task into a list of chores. */}
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-jade-700 dark:text-jade-400">
              {STEPS[step]}
            </p>
            <p className="stat-label">
              {step + 1} of {STEPS.length}
            </p>
          </div>
          <div className="flex gap-1.5" role="presentation">
            {STEPS.map((label, i) => (
              <span
                key={label}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                  i <= step ? 'bg-jade-600 dark:bg-jade-400' : 'bg-stone-200 dark:bg-stone-800'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="card animate-slide-up space-y-5 bg-white/85 p-6 backdrop-blur-xl dark:bg-stone-900/80">
          {step === 0 && (
            <div className="space-y-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-jade-500 via-jade-600 to-jade-700 shadow-lg shadow-jade-900/20 dark:shadow-none">
                <Sparkles className="h-7 w-7 text-white" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                  Let&apos;s set up your targets
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                  Five short questions. We work out what your body burns in a day, then turn
                  that into a calorie and protein target you can actually hit.
                </p>
              </div>
              <ul className="space-y-3">
                {[
                  { icon: NotebookPen, text: 'Log meals by searching, scanning or just typing what you ate.' },
                  { icon: TrendingUp, text: 'Weigh in whenever you like — we read the trend, not the daily noise.' },
                  { icon: Target, text: 'Targets adjust as your weight moves, so they stay honest.' },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-jade-50 dark:bg-jade-900/40">
                      <Icon className="h-4 w-4 text-jade-700 dark:text-jade-400" aria-hidden="true" />
                    </span>
                    <span className="text-sm leading-snug text-stone-700 dark:text-stone-300">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-stone-600 dark:text-stone-400">
                These four numbers set every target in the app. Nothing here is shared with anyone.
              </p>

              <FieldShell label="What should we call you?" htmlFor="ob-name">
                <input
                  id="ob-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Optional"
                  autoComplete="given-name"
                  className="input-field"
                />
              </FieldShell>

              <FieldShell label="Sex used for the calculation">
                <div className="grid grid-cols-3 gap-2">
                  {(['male', 'female', 'other'] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={gender === g}
                      onClick={() => setGender(g)}
                      className={`min-h-[44px] rounded-xl border text-sm font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 ${
                        gender === g
                          ? 'border-jade-600 bg-jade-50 text-jade-800 dark:border-jade-400/60 dark:bg-jade-900/30 dark:text-jade-200'
                          : 'border-stone-200 text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:text-stone-400'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-500">
                  Body-fat and calorie formulas differ by sex. &ldquo;Other&rdquo; uses the average of both.
                </p>
              </FieldShell>

              <FieldShell label="Age" htmlFor="ob-age">
                <input
                  id="ob-age"
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 28"
                  className="input-field"
                />
              </FieldShell>

              <FieldShell
                label="Height"
                htmlFor="ob-height"
                aside={
                  <UnitToggle
                    label="Height unit"
                    value={heightUnit}
                    onChange={switchHeightUnit}
                    options={[
                      { value: 'cm', label: 'cm' },
                      { value: 'ft', label: 'ft / in' },
                    ]}
                  />
                }
              >
                {heightUnit === 'cm' ? (
                  <input
                    id="ob-height"
                    value={heightCmText}
                    onChange={e => setHeightCmText(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 175"
                    className="input-field"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      id="ob-height"
                      value={heightFt}
                      onChange={e => setHeightFt(e.target.value)}
                      inputMode="numeric"
                      placeholder="feet"
                      aria-label="Height in feet"
                      className="input-field"
                    />
                    <input
                      value={heightIn}
                      onChange={e => setHeightIn(e.target.value)}
                      inputMode="numeric"
                      placeholder="inches"
                      aria-label="Height in inches"
                      className="input-field"
                    />
                  </div>
                )}
              </FieldShell>

              <FieldShell
                label="Weight today"
                htmlFor="ob-weight"
                aside={
                  <UnitToggle
                    label="Weight unit"
                    value={weightUnit}
                    onChange={switchWeightUnit}
                    options={[
                      { value: 'kg', label: 'kg' },
                      { value: 'lbs', label: 'lbs' },
                    ]}
                  />
                }
              >
                <input
                  id="ob-weight"
                  value={weightText}
                  onChange={e => setWeightText(e.target.value)}
                  inputMode="decimal"
                  placeholder={weightUnit === 'kg' ? 'e.g. 72.5' : 'e.g. 160'}
                  className="input-field"
                />
                <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-500">
                  Rough is fine. This becomes your first weigh-in.
                </p>
              </FieldShell>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-stone-600 dark:text-stone-400">
                Pick the line closest to a normal week — not your best one. Overshooting here is
                the most common reason a target ends up too high.
              </p>
              {ACTIVITY_CHOICES.map(c => (
                <OptionRow
                  key={c.value}
                  label={c.label}
                  detail={c.detail}
                  selected={activityLevel === c.value}
                  onSelect={() => setActivityLevel(c.value)}
                />
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-3">
                {GOAL_CHOICES.map(c => (
                  <OptionRow
                    key={c.value}
                    label={c.label}
                    detail={c.detail}
                    selected={goal === c.value}
                    onSelect={() => changeGoal(c.value)}
                  />
                ))}
              </div>

              {goal !== 'maintain' && (
                <div className="space-y-4 border-t border-stone-200 pt-4 dark:border-stone-800">
                  <FieldShell label="How fast?">
                    <div className="space-y-2">
                      {pacesFor(goal).map(p => (
                        <OptionRow
                          key={p.kgPerWeek}
                          label={`${p.label} — ${
                            weightUnit === 'kg'
                              ? `${p.kgPerWeek} kg`
                              : `${Math.round(lbsFromKg(p.kgPerWeek) * 10) / 10} lbs`
                          } a week`}
                          detail={p.detail}
                          selected={pace === p.kgPerWeek}
                          onSelect={() => setPace(p.kgPerWeek)}
                        />
                      ))}
                    </div>
                  </FieldShell>

                  <FieldShell label={`Goal weight (${weightSuffix})`} htmlFor="ob-target">
                    <input
                      id="ob-target"
                      value={targetText}
                      onChange={e => setTargetText(e.target.value)}
                      inputMode="decimal"
                      placeholder="Optional — you can set this later"
                      className="input-field"
                    />
                    {horizon && (
                      <p className="mt-1.5 text-xs font-medium text-jade-700 dark:text-jade-400">{horizon}</p>
                    )}
                  </FieldShell>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                  Here&apos;s your daily target
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                  You burn roughly{' '}
                  <strong className="text-stone-900 dark:text-stone-100">{plan.tdee} kcal</strong> a day.
                  {goal === 'lose' && ' Eating under that is what moves the scale down.'}
                  {goal === 'gain' && ' Eating over that is what gives training something to build with.'}
                  {goal === 'maintain' && ' Matching it holds you steady.'}
                </p>
              </div>

              <div className="rounded-2xl border border-jade-600/20 bg-jade-50 p-5 text-center dark:border-jade-400/20 dark:bg-jade-900/25">
                <p className="stat-label">Eat per day</p>
                <p className="font-display text-4xl font-bold tabular-nums text-jade-800 dark:text-jade-200">
                  {plan.calories}
                  <span className="ml-1 text-lg font-semibold">kcal</span>
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Protein', value: plan.protein, color: 'text-macro-protein' },
                  { label: 'Carbs', value: plan.carbs, color: 'text-macro-carbs' },
                  { label: 'Fat', value: plan.fat, color: 'text-macro-fat' },
                ].map(m => (
                  <div
                    key={m.label}
                    className="rounded-xl border border-stone-200 bg-white p-3 text-center dark:border-stone-800 dark:bg-stone-900/60"
                  >
                    <p className={`font-display text-xl font-bold tabular-nums ${m.color}`}>{m.value}g</p>
                    <p className="stat-label">{m.label}</p>
                  </div>
                ))}
              </div>

              <ul className="space-y-2.5">
                {[
                  { icon: Flame, text: 'Nothing is locked in — every number is editable under Goals.' },
                  { icon: Activity, text: 'Log for a couple of weeks and the coach re-checks these against your real weight trend.' },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5">
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-jade-700 dark:text-jade-400" aria-hidden="true" />
                    <span className="text-sm leading-snug text-stone-600 dark:text-stone-400">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm font-medium text-[#B91C1C] dark:text-[#F87171]">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            {step > 0 && (
              <button type="button" onClick={back} className="btn-secondary">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
            )}
            <button type="button" onClick={next} className="btn-primary flex-1">
              {step === 0 ? 'Get started' : step === STEPS.length - 1 ? 'Start tracking' : 'Continue'}
              {step < STEPS.length - 1 && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
