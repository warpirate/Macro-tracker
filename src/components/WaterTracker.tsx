import React from 'react'
import { Droplets, Check, Minus } from 'lucide-react'
import { useStore } from '../store/useStore'

interface WaterTrackerProps {
  date: string
}

const QUICK_ADD_AMOUNTS = [150, 250, 350, 500]

export const WaterTracker: React.FC<WaterTrackerProps> = ({ date }) => {
  const waterIntake = useStore(s => s.diary[date]?.waterIntake ?? 0)
  const goalMl = useStore(s => s.goals.water)
  const addWater = useStore(s => s.addWater)
  const setWaterIntake = useStore(s => s.setWaterIntake)

  const pct = Math.min((waterIntake / goalMl) * 100, 100)
  const glasses = Math.round(waterIntake / 250)
  const goalMet = waterIntake >= goalMl

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Droplets className="h-5 w-5 text-jade-600 dark:text-jade-400" aria-hidden="true" />
          <h3 className="section-title mb-0">Water</h3>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
            {waterIntake}
            <span className="ml-1 font-sans text-sm font-medium text-stone-500">ml</span>
          </p>
          <p className="mt-1 text-sm font-medium text-stone-500">
            of <span className="font-display tabular-nums">{goalMl}</span> ml
          </p>
        </div>
      </div>

      {/* Volume indicator */}
      <div
        role="progressbar"
        aria-label="Water intake"
        aria-valuemin={0}
        aria-valuemax={goalMl}
        aria-valuenow={waterIntake}
        aria-valuetext={`${waterIntake} of ${goalMl} millilitres`}
        className="mb-3 h-2.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
      >
        <div
          className="progress-bar-fill h-full rounded-full bg-jade-600 dark:bg-jade-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {goalMet && (
        <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-jade-700 dark:text-jade-400">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Goal met
        </p>
      )}

      {/* Glasses — tap one to set the level */}
      <div className="mb-3 -mx-1 flex flex-wrap">
        {Array.from({ length: Math.ceil(goalMl / 250) }).map((_, i) => {
          const filled = i < glasses
          return (
            <button
              key={i}
              onClick={() => setWaterIntake(date, (i + 1) * 250)}
              title={`${(i + 1) * 250}ml`}
              aria-label={`Set water intake to ${(i + 1) * 250} ml`}
              aria-pressed={filled}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-150 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:hover:bg-stone-800 dark:focus-visible:ring-offset-stone-900"
            >
              <Droplets
                className={`h-5 w-5 transition-colors duration-150 ${
                  filled ? 'text-jade-600 dark:text-jade-400' : 'text-stone-300 dark:text-stone-700'
                }`}
                fill={filled ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>

      {/* Quick add */}
      <div className="flex gap-2">
        {QUICK_ADD_AMOUNTS.map(amount => (
          <button
            key={amount}
            onClick={() => addWater(date, amount)}
            aria-label={`Add ${amount} ml of water`}
            className="min-h-[44px] flex-1 rounded-xl border border-jade-100 bg-jade-50 px-1 text-sm font-semibold text-jade-700 transition-colors duration-150 hover:bg-jade-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-jade-900/60 dark:bg-jade-900/25 dark:text-jade-300 dark:hover:bg-jade-900/40 dark:focus-visible:ring-offset-stone-900"
          >
            <span className="font-display tabular-nums">+{amount >= 1000 ? amount / 1000 : amount}</span>
            <span className="text-[11px]">{amount >= 1000 ? 'L' : 'ml'}</span>
          </button>
        ))}
        <button onClick={() => addWater(date, -250)} className="btn-icon" aria-label="Remove 250 ml of water">
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
