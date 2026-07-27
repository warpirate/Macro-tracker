import React from 'react'
import {
  Check,
  Minus,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  WifiOff,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PhaseType } from '../../types'
import { useCoach } from '../../hooks/useCoach'
import { CoachAlerts } from './CoachAlerts'

export interface CoachPanelProps {
  className?: string
}

const PHASE_META: Record<PhaseType, { label: string; Icon: LucideIcon }> = {
  cut: { label: 'Cut', Icon: TrendingDown },
  lean_bulk: { label: 'Lean bulk', Icon: TrendingUp },
  maintain: { label: 'Maintain', Icon: Minus },
  recomp: { label: 'Recomp', Icon: Repeat },
}

/** A data number inside a sentence still wears the display face. */
const Figure: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="font-display font-semibold tabular-nums">{children}</span>
)

/** Placeholder block for the loading state — shimmer, never a bare spinner. */
const Shimmer: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden="true"
    className={`animate-shimmer rounded-lg bg-stone-200 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] dark:bg-stone-800 dark:from-stone-800 dark:via-stone-700 dark:to-stone-800 ${className ?? ''}`}
  />
)

const Notice: React.FC<{ icon: LucideIcon; children: React.ReactNode }> = ({
  icon: Icon,
  children,
}) => (
  <div className="flex items-start gap-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-800/40">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
    <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-400">{children}</p>
  </div>
)

/*
  The macro number reuses .stat-value for its typography, then overrides the color in
  BOTH modes. The dark override is required, not decorative: @apply puts
  `.dark .stat-value { color: … }` in the components layer at (0,2,0), which would beat a
  bare `text-macro-*` utility at (0,1,0). `dark:text-macro-*` matches that specificity and
  sits in the later utilities layer, so it wins. The value itself is the CSS custom
  property, which is already redefined under .dark.
*/
const MacroCell: React.FC<{ label: string; grams: number; dot: string; text: string }> = ({
  label,
  grams,
  dot,
  text,
}) => (
  <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <p className="stat-label">{label}</p>
    </div>
    <p className={`stat-value mt-1.5 ${text}`}>
      {Math.round(grams).toLocaleString()}
      <span className="ml-0.5 font-sans text-sm font-medium text-stone-500">g</span>
    </p>
  </div>
)

/**
 * The coach's recommendation card. Works with no props — it derives everything from the
 * store through `useCoach`. Renders an honest empty state rather than a placeholder
 * number, a shimmer skeleton while a plan is being built, and the plan itself once there
 * is one. Nothing is applied to the user's goals until they press Accept.
 */
export const CoachPanel: React.FC<CoachPanelProps> = ({ className }) => {
  const { recommendation, alerts, accepted, anchorSource, loading, error, refresh, accept } =
    useCoach()

  const wrapperClass = ['card p-5', className].filter(Boolean).join(' ')

  // --- Loading, with nothing to show underneath it ---------------------------
  if (loading && !recommendation) {
    return (
      <section className={wrapperClass} aria-busy="true" aria-live="polite">
        <span className="sr-only">Building your plan</span>
        <div className="flex items-start justify-between gap-3">
          <Shimmer className="h-4 w-28" />
          <Shimmer className="h-6 w-24 rounded-full" />
        </div>
        <Shimmer className="mt-5 h-12 w-44" />
        <Shimmer className="mt-2.5 h-3 w-24" />
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Shimmer className="h-20" />
          <Shimmer className="h-20" />
          <Shimmer className="h-20" />
        </div>
        <div className="mt-5 space-y-2">
          <Shimmer className="h-3 w-full" />
          <Shimmer className="h-3 w-11/12" />
          <Shimmer className="h-3 w-2/3" />
        </div>
      </section>
    )
  }

  // --- Nothing built yet -----------------------------------------------------
  if (!recommendation) {
    return (
      <section className={wrapperClass} aria-labelledby="coach-panel-heading">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 shrink-0 text-jade-700 dark:text-jade-400" aria-hidden="true" />
          <h2 id="coach-panel-heading" className="section-title mb-0">
            Coach
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
          Coach reads your weight trend, what you have actually logged and your body
          measurements, works out the calories you really burn, then proposes a phase with a
          calorie target and macros to match. Nothing touches your goals until you accept it.
        </p>
        <button type="button" className="btn-primary mt-4 w-full sm:w-auto" onClick={refresh}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Get my plan
        </button>
        <CoachAlerts alerts={alerts} className="mt-4" />
      </section>
    )
  }

  // --- The plan --------------------------------------------------------------
  const phase = PHASE_META[recommendation.phase]
  const PhaseIcon = phase.Icon
  const rate = recommendation.targetRateKgPerWeek
  const rateCaption = rate < 0 ? 'losing' : rate > 0 ? 'gaining' : 'holding steady'

  return (
    <section className={wrapperClass} aria-labelledby="coach-panel-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="stat-label">Your coach</p>
          <h2
            id="coach-panel-heading"
            className="mt-1 font-display text-lg font-semibold leading-snug tracking-tight text-stone-900 dark:text-stone-100"
          >
            {recommendation.headline}
          </h2>
        </div>
        <span className="pill shrink-0">
          <PhaseIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {phase.label}
        </span>
      </div>

      {/* The one number the whole card exists for. */}
      <p className="stat-value mt-5 text-5xl leading-none sm:text-6xl">
        {recommendation.calories.toLocaleString()}
      </p>
      <p className="stat-label mt-2">kcal per day</p>
      <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">
        Built around your <Figure>{Math.round(recommendation.tdeeUsed).toLocaleString()}</Figure>{' '}
        kcal/day {anchorSource} burn
      </p>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <MacroCell
          label="Protein"
          grams={recommendation.protein}
          dot="bg-macro-protein"
          text="text-macro-protein dark:text-macro-protein"
        />
        <MacroCell
          label="Carbs"
          grams={recommendation.carbs}
          dot="bg-macro-carbs"
          text="text-macro-carbs dark:text-macro-carbs"
        />
        <MacroCell
          label="Fat"
          grams={recommendation.fat}
          dot="bg-macro-fat"
          text="text-macro-fat dark:text-macro-fat"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
          <p className="stat-label">Target rate</p>
          <p className="stat-value mt-1.5">
            {rate > 0 ? '+' : ''}
            {rate.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-500">
            kg per week · {rateCaption}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
          <p className="stat-label">Duration</p>
          <p className="stat-value mt-1.5">{recommendation.durationWeeks}</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-500">weeks in this phase</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
        {recommendation.rationale}
      </p>

      <div className="mt-4 space-y-2" aria-live="polite">
        {error ? (
          <Notice icon={WifiOff}>
            {error} It is a plain formula rather than a coached judgement — press Refresh when
            you are back online.
          </Notice>
        ) : recommendation.source === 'local' ? (
          <Notice icon={WifiOff}>
            This is the offline estimate, calculated on your device from your own numbers
            rather than by the AI coach. Refresh to ask the coach for a full plan.
          </Notice>
        ) : null}

        {recommendation.clamped ? (
          <Notice icon={ShieldCheck}>
            Some of these numbers were adjusted to stay inside a safe range — calories within
            25% of your burn, protein 1.4-3.0 g per kg, and enough fat for hormone health.
          </Notice>
        ) : null}
      </div>

      {accepted ? (
        <p className="mt-4 flex items-start gap-2 text-sm font-medium leading-relaxed text-jade-700 dark:text-jade-400">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Your daily goals now match this plan: <Figure>{recommendation.calories}</Figure> kcal,{' '}
            <Figure>{recommendation.protein}</Figure> g protein,{' '}
            <Figure>{recommendation.carbs}</Figure> g carbs, <Figure>{recommendation.fat}</Figure> g
            fat.
          </span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {accepted ? (
          <button type="button" className="btn-secondary" disabled>
            <Check className="h-4 w-4" aria-hidden="true" />
            Plan accepted
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={accept}>
            <Check className="h-4 w-4" aria-hidden="true" />
            Accept plan
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={refresh} disabled={loading}>
          <RefreshCw
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <CoachAlerts alerts={alerts} className="mt-4" />
    </section>
  )
}
