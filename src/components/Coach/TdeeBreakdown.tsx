import React from 'react'
import { Activity, Flame } from 'lucide-react'
import type { TdeeEstimate } from '../../types'
import { useCoachData } from '../../hooks/useCoach'

export interface TdeeBreakdownProps {
  /** Supply an estimate to render, or omit it and the component derives its own. */
  tdee?: TdeeEstimate
  className?: string
}

/** Qualifying days needed before intake can be turned into a measured burn. Matches tdee.ts. */
const MIN_DAYS_FOR_MEASURED = 10

/** A gap this small is noise rather than a real difference between the two numbers. */
const NOISE_KCAL = 50

const BASIS_LABEL: Record<TdeeEstimate['basis'], string> = {
  mifflin: 'Mifflin-St Jeor formula',
  katch: 'Katch-McArdle, from your lean mass',
}

const CONFIDENCE_LABEL: Record<TdeeEstimate['confidence'], string> = {
  none: 'Not measured yet',
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/**
 * Returns the one plain sentence that explains the two numbers. When nothing has been
 * measured it says so outright and states exactly what is still missing — never a
 * reassuring hedge over an empty column.
 */
const explain = (tdee: TdeeEstimate): string => {
  if (tdee.measured === null) {
    const daysShort = Math.max(0, MIN_DAYS_FOR_MEASURED - tdee.daysOfData)
    const needsWeight = tdee.weightTrendKgPerWeek === null
    const opening = `The app is still using the ${BASIS_LABEL[tdee.basis].toLowerCase()} — nothing here has been measured from your own data yet.`

    if (daysShort > 0 && needsWeight) {
      return `${opening} Log everything you eat on ${daysShort} more ${plural(daysShort, 'day', 'days')}, and weigh in at least twice across a stretch of 10 days or more.`
    }
    if (daysShort > 0) {
      return `${opening} Log everything you eat on ${daysShort} more ${plural(daysShort, 'day', 'days')} and a measured number will appear here.`
    }
    if (needsWeight) {
      return `${opening} You have ${tdee.daysOfData} fully logged ${plural(tdee.daysOfData, 'day', 'days')} — now weigh in at least twice across a stretch of 10 days or more and a measured number will appear here.`
    }
    return `${opening} Your logged intake and weight trend do not yet combine into a usable number.`
  }

  const gap = tdee.measured - tdee.predicted
  const size = Math.round(Math.abs(gap))
  const trend = tdee.weightTrendKgPerWeek
  const trendClause =
    trend === null
      ? `from ${tdee.daysOfData} logged ${plural(tdee.daysOfData, 'day', 'days')}`
      : `from ${tdee.daysOfData} logged ${plural(tdee.daysOfData, 'day', 'days')} against a weight trend of ${trend > 0 ? '+' : ''}${trend.toFixed(2)} kg a week`

  if (size < NOISE_KCAL) {
    return `Your measured burn lands within ${size} kcal of the formula ${trendClause}, so the estimate is holding up well.`
  }
  return `Your measured burn is about ${size} kcal a day ${gap > 0 ? 'higher' : 'lower'} than the formula predicts, ${trendClause}. The measured number is the better one to plan around.`
}

/**
 * Predicted versus measured daily calorie burn, with the confidence, the day count and
 * the weight trend behind them. The measured column shows a dash — never a stand-in
 * number — until there is genuinely enough data to compute one.
 */
export const TdeeBreakdown: React.FC<TdeeBreakdownProps> = ({ tdee, className }) => {
  const derived = useCoachData()
  const estimate = tdee ?? derived.tdee
  const trend = estimate.weightTrendKgPerWeek

  return (
    <section
      className={['card p-5', className].filter(Boolean).join(' ')}
      aria-labelledby="tdee-breakdown-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tdee-breakdown-heading" className="section-title mb-0">
          Your calorie burn
        </h2>
        <span className="pill">{CONFIDENCE_LABEL[estimate.confidence]}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
            <p className="stat-label">Predicted</p>
          </div>
          <p className="stat-value mt-1.5">{Math.round(estimate.predicted).toLocaleString()}</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-500">
            kcal/day · {BASIS_LABEL[estimate.basis]}
          </p>
        </div>

        <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
          <div className="flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
            <p className="stat-label">Measured</p>
          </div>
          {estimate.measured === null ? (
            <p className="stat-value mt-1.5 text-stone-300 dark:text-stone-700">
              <span aria-hidden="true">—</span>
              <span className="sr-only">Not available</span>
            </p>
          ) : (
            <p className="stat-value mt-1.5">{estimate.measured.toLocaleString()}</p>
          )}
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-500">
            {estimate.measured === null ? 'Not enough data yet' : 'kcal/day · from your own log'}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="flex items-baseline gap-2">
          <dt className="stat-label">Days of data</dt>
          <dd className="font-display font-semibold tabular-nums text-stone-900 dark:text-stone-100">
            {estimate.daysOfData}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="stat-label">Weight trend</dt>
          <dd className="font-display font-semibold tabular-nums text-stone-900 dark:text-stone-100">
            {/* Always kg/week: the estimate and every coach alert quote kg, and mixing
                units between the two on one screen is worse than a single conversion. */}
            {trend === null ? (
              <span className="font-sans text-sm font-medium text-stone-500">Not enough weigh-ins</span>
            ) : (
              `${trend > 0 ? '+' : ''}${trend.toFixed(2)} kg/wk`
            )}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
        {explain(estimate)}
      </p>
    </section>
  )
}
