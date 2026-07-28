import React, { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CalendarClock, Check, Minus, Scale, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { getWeightTargetProgress, type TrackStatus } from '../utils/weightTarget'
import { getTodayString } from '../utils/calculations'

const LBS_PER_KG = 2.20462

/** Status drives an icon and words, never colour alone — design system §2. */
const STATUS_META: Record<
  TrackStatus,
  { label: string; tone: 'good' | 'warning' | 'critical' | 'neutral' }
> = {
  no_target: { label: 'No goal set', tone: 'neutral' },
  insufficient_data: { label: 'Projected from your plan', tone: 'neutral' },
  reached: { label: 'Goal reached', tone: 'good' },
  on_track: { label: 'On track', tone: 'good' },
  ahead: { label: 'Faster than planned', tone: 'warning' },
  slow: { label: 'Stalled', tone: 'warning' },
  wrong_way: { label: 'Going the wrong way', tone: 'critical' },
}

const TONE_CLASS = {
  good: {
    text: 'text-jade-700 dark:text-jade-400',
    surface: 'border-jade-600/25 bg-jade-50 dark:border-jade-400/25 dark:bg-jade-900/25',
  },
  warning: {
    text: 'text-[#B45309] dark:text-[#F59E0B]',
    surface: 'border-[#B45309]/25 bg-[#B45309]/[0.06] dark:border-[#F59E0B]/25 dark:bg-[#F59E0B]/10',
  },
  critical: {
    text: 'text-[#B91C1C] dark:text-[#F87171]',
    surface: 'border-[#B91C1C]/25 bg-[#B91C1C]/[0.06] dark:border-[#F87171]/25 dark:bg-[#F87171]/10',
  },
  neutral: {
    text: 'text-stone-600 dark:text-stone-400',
    surface: 'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/50',
  },
} as const

const Figure: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="font-display font-semibold tabular-nums">{children}</span>
)

/**
 * Where the user is, where they are going, and when they will get there.
 *
 * The mobile app has had this since the coach shipped; the website had nothing, so the
 * one number people actually open the app for — how long is left — was mobile-only.
 */
export const WeightGoalCard: React.FC = () => {
  const profile = useStore(s => s.profile)
  const weightLog = useStore(s => s.weightLog)
  const currentWeightKg = useStore(s => s.currentWeightKg)
  const addWeightEntry = useStore(s => s.addWeightEntry)

  const [draft, setDraft] = useState('')

  const today = getTodayString()
  const loggedToday = weightLog.some(e => e.date === today)

  const progress = useMemo(
    () => getWeightTargetProgress(weightLog, profile, currentWeightKg, today),
    [weightLog, profile, currentWeightKg, today],
  )

  const unit = profile.weightUnit
  const toDisplay = (kg: number): number =>
    Math.round((unit === 'lbs' ? kg * LBS_PER_KG : kg) * 10) / 10

  const meta = STATUS_META[progress.status]
  const tone = TONE_CLASS[meta.tone]
  const StatusIcon =
    meta.tone === 'good' ? Check : meta.tone === 'critical' ? AlertTriangle : Minus

  const TrendIcon =
    progress.trendKgPerWeek === null || progress.trendKgPerWeek === 0
      ? Minus
      : progress.trendKgPerWeek < 0
        ? ArrowDown
        : ArrowUp

  const submitWeighIn = (e: React.FormEvent) => {
    e.preventDefault()
    const value = Number(draft.replace(',', '.').trim())
    if (!Number.isFinite(value) || value <= 0) return
    // Stored in the display unit, exactly like every other entry in the weight log.
    addWeightEntry({ date: today, weight: Math.round(value * 10) / 10 })
    setDraft('')
  }

  return (
    <section className="card space-y-4 p-5" aria-label="Weight goal">
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-jade-700 dark:text-jade-400" aria-hidden="true" />
        <h2 className="section-title mb-0">Weight goal</h2>
      </div>

      {progress.targetKg === null ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">{progress.message}</p>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <p className="stat-value text-4xl">{toDisplay(currentWeightKg)}</p>
            <p className="mb-1.5 text-sm text-stone-500 dark:text-stone-500">
              {unit} → <Figure>{toDisplay(progress.targetKg)}</Figure> {unit}
            </p>
          </div>

          {progress.fraction !== null && (
            <div className="space-y-1.5">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div
                  className="progress-bar-fill h-full rounded-full bg-jade-600 dark:bg-jade-400"
                  style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                />
              </div>
              <p className="stat-label">
                {Math.round(progress.fraction * 100)}% of the way from your starting weight
              </p>
            </div>
          )}

          {/* The countdown. The single most-read number on this card, so it gets its own
              row rather than being buried in the status sentence. */}
          {progress.etaDays !== null && (
            <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/50">
              <CalendarClock
                className="h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400"
                aria-hidden="true"
              />
              <p className="text-sm text-stone-700 dark:text-stone-300">
                <Figure>{progress.etaDays}</Figure> days left
                <span className="text-stone-500 dark:text-stone-500">
                  {' '}
                  ({progress.etaWeeks} week{progress.etaWeeks === 1 ? '' : 's'})
                </span>
                {progress.etaIsProjected && (
                  <span className="text-stone-500 dark:text-stone-500"> · at your planned pace</span>
                )}
              </p>
            </div>
          )}

          <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${tone.surface}`}>
            <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.text}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${tone.text}`}>{meta.label}</p>
              <p className="mt-0.5 text-sm leading-snug text-stone-600 dark:text-stone-400">
                {progress.message}
              </p>
            </div>
          </div>

          {progress.trendKgPerWeek !== null && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="stat-label">Trend</p>
                <p className="flex items-center gap-1">
                  <TrendIcon
                    className="h-4 w-4 text-stone-500 dark:text-stone-400"
                    aria-hidden="true"
                  />
                  <span className="stat-value text-lg">
                    {toDisplay(Math.abs(progress.trendKgPerWeek))}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-500">{unit}/week</span>
                </p>
              </div>
              <div>
                <p className="stat-label">Based on</p>
                <p className="flex items-baseline gap-1">
                  <span className="stat-value text-lg">{progress.daysOfTrend}</span>
                  <span className="text-xs text-stone-500 dark:text-stone-500">days of weigh-ins</span>
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Daily weigh-in. Direction can only be measured if this happens regularly. */}
      {loggedToday ? (
        <p className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
          <Check className="h-4 w-4 shrink-0 text-jade-700 dark:text-jade-400" aria-hidden="true" />
          Weighed in today. Daily weigh-ins make the trend far more reliable.
        </p>
      ) : (
        <form onSubmit={submitWeighIn} className="space-y-1.5">
          <label htmlFor="weigh-in" className="label-text">
            Today&apos;s weight ({unit})
          </label>
          <div className="flex gap-2">
            <input
              id="weigh-in"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              inputMode="decimal"
              placeholder={String(toDisplay(currentWeightKg))}
              className="input-field flex-1"
            />
            <button type="submit" disabled={draft.trim().length === 0} className="btn-primary px-5">
              Log
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
