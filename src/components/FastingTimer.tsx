import React, { useState, useEffect } from 'react'
import { Timer, Square, CheckCircle2 } from 'lucide-react'
import { useStore } from '../store/useStore'

const PRESETS = [
  { label: '16:8', hours: 16 },
  { label: '18:6', hours: 18 },
  { label: '20:4', hours: 20 },
  { label: 'OMAD',  hours: 23 },
]

const fmt = (ms: number) => {
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const FastingTimer: React.FC = () => {
  const fastingSession = useStore(s => s.fastingSession)
  const startFasting   = useStore(s => s.startFasting)
  const stopFasting    = useStore(s => s.stopFasting)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!fastingSession) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [fastingSession?.startTime])

  if (!fastingSession) {
    return (
      <div className="card p-4">
        <h3 className="section-title mb-1 flex items-center gap-2">
          <Timer className="h-4 w-4 text-jade-600 dark:text-jade-400" aria-hidden="true" />
          Fasting Timer
        </h3>
        <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Choose a protocol to start a fast.</p>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => startFasting(p.hours)}
              aria-label={`Start a ${p.hours} hour ${p.label} fast`}
              className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl border border-stone-200 bg-stone-50 px-1 py-2 transition-colors duration-150 hover:border-jade-200 hover:bg-jade-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-stone-800 dark:bg-stone-800/50 dark:hover:border-jade-800 dark:hover:bg-jade-900/25 dark:focus-visible:ring-offset-stone-900"
            >
              <span className="font-display text-base font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
                {p.label}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-stone-500">{p.hours}h</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const elapsed   = Date.now() - fastingSession.startTime
  const targetMs  = fastingSession.targetHours * 3600 * 1000
  const remaining = Math.max(0, targetMs - elapsed)
  const pct       = Math.min((elapsed / targetMs) * 100, 100)
  const done      = elapsed >= targetMs
  const r         = 34
  const circ      = 2 * Math.PI * r

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="section-title mb-0 flex items-center gap-2">
            {done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-jade-600 dark:text-jade-400" aria-hidden="true" />
            ) : (
              <Timer className="h-4 w-4 shrink-0 text-jade-600 dark:text-jade-400" aria-hidden="true" />
            )}
            {done ? 'Fast complete' : `${fastingSession.targetHours}:${24 - fastingSession.targetHours} Fast`}
          </h3>
          <p className="mt-1 text-sm font-medium text-stone-500">
            Target <span className="font-display tabular-nums text-stone-700 dark:text-stone-300">{fastingSession.targetHours}</span> h
          </p>
        </div>
        <button
          onClick={stopFasting}
          title="End fast"
          aria-label="End fast"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-[#B91C1C] transition-colors duration-150 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-[#F87171] dark:hover:bg-stone-800 dark:focus-visible:ring-offset-stone-900"
        >
          <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />
          End fast
        </button>
      </div>

      <div className="flex items-center gap-5">
        {/* Progress ring */}
        <div
          className="relative h-[88px] w-[88px] shrink-0"
          role="img"
          aria-label={`${Math.round(pct)}% of target fast elapsed`}
        >
          <svg className="h-full w-full -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40" cy="40" r={r}
              className="text-stone-200 dark:text-stone-800"
              stroke="currentColor"
              strokeWidth="7"
              fill="none"
            />
            <circle
              cx="40" cy="40" r={r}
              className="text-jade-600 dark:text-jade-400"
              stroke="currentColor"
              strokeWidth="7"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct / 100)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-200">
            {Math.round(pct)}%
          </span>
        </div>

        {/* Elapsed is the hero — tabular so the digits do not jitter as it ticks */}
        <div className="min-w-0 flex-1">
          <p className="stat-label">Elapsed</p>
          <p className="mt-1 font-display text-3xl font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
            {fmt(elapsed)}
          </p>
          <div className="mt-3">
            {done ? (
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-jade-700 dark:text-jade-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                Target reached
              </p>
            ) : (
              <>
                <p className="stat-label">Remaining</p>
                <p className="mt-1 font-display text-base font-semibold leading-none tabular-nums text-stone-600 dark:text-stone-400">
                  {fmt(remaining)}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
