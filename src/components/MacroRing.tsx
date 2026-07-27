import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface MacroRingProps {
  calories: number
  goal: number
  protein: number
  carbs: number
  fat: number
  size?: number
}

/* Reserved critical status color — docs/DESIGN-SYSTEM.md §2. Never a macro hue. */
const CRITICAL_TEXT = 'text-[#B91C1C] dark:text-[#F87171]'

/* 600ms is the progress-fill duration from §3. The global prefers-reduced-motion
   block in index.css overrides transition-duration with !important, so the arc
   snaps to its new value instead of sweeping when reduced motion is requested. */
const ARC_TRANSITION =
  'stroke-dasharray 600ms ease-in-out, stroke-dashoffset 600ms ease-in-out'

const LEGEND = [
  { key: 'protein', label: 'Protein', swatch: 'bg-macro-protein' },
  { key: 'carbs', label: 'Carbs', swatch: 'bg-macro-carbs' },
  { key: 'fat', label: 'Fat', swatch: 'bg-macro-fat' },
]

export const MacroRing: React.FC<MacroRingProps> = ({
  calories, goal, protein, carbs, fat, size = 180
}) => {
  const cx = size / 2
  const cy = size / 2
  const strokeWidth = size * 0.08
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const totalMacroCalories = protein * 4 + carbs * 4 + fat * 9
  const proteinPct = totalMacroCalories > 0 ? (protein * 4) / totalMacroCalories : 0
  const carbsPct = totalMacroCalories > 0 ? (carbs * 4) / totalMacroCalories : 0
  const fatPct = totalMacroCalories > 0 ? (fat * 9) / totalMacroCalories : 0

  const caloriePct = Math.min(calories / Math.max(goal, 1), 1)
  const proteinLen = caloriePct * proteinPct * circumference
  const carbsLen = caloriePct * carbsPct * circumference
  const fatLen = caloriePct * fatPct * circumference

  /* Segments run head-to-tail clockwise from 12 o'clock. Colors come from the
     CSS custom properties so dark mode swaps automatically. */
  const segments = [
    { key: 'protein', color: 'var(--macro-protein)', start: 0, length: proteinLen },
    { key: 'carbs', color: 'var(--macro-carbs)', start: proteinLen, length: carbsLen },
    { key: 'fat', color: 'var(--macro-fat)', start: proteinLen + carbsLen, length: fatLen },
  ]

  /* The separation is carved out of each segment rather than inserted between
     them, so a round-capped arc still spans its true extent. Segments thinner
     than the stroke collapse to a centred dot instead of vanishing. */
  const segmentGap = Math.max(size * 0.02, 2)
  const dashFor = (length: number) => Math.max(length - strokeWidth - segmentGap, 0.01)

  const remaining = Math.max(goal - calories, 0)
  const over = Math.max(calories - goal, 0)
  const isOver = over > 0

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          focusable="false"
          aria-label={
            `Macro split: protein ${Math.round(protein)} grams, ` +
            `carbs ${Math.round(carbs)} grams, fat ${Math.round(fat)} grams`
          }
        >
          {/* Recessive track */}
          <circle
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-stone-200 dark:text-stone-800"
          />

          {segments.map(({ key, color, start, length }) => {
            if (length <= 0) return null
            const dash = dashFor(length)
            return (
              <circle
                key={key}
                cx={cx} cy={cy} r={radius}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-(start + (length - dash) / 2)}
                style={{ transition: ARC_TRANSITION }}
              />
            )
          })}
        </svg>

        {/* Center readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span
            className={`font-display font-semibold leading-none tabular-nums ${
              isOver ? CRITICAL_TEXT : 'text-stone-900 dark:text-stone-100'
            }`}
            style={{ fontSize: Math.round(size * 0.2) }}
          >
            {Math.round(calories).toLocaleString()}
          </span>

          <span className="stat-label mt-1.5">kcal eaten</span>

          {isOver ? (
            <span
              className={`mt-1.5 inline-flex items-center gap-1 text-xs font-semibold ${CRITICAL_TEXT}`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="font-display tabular-nums">
                {Math.round(over).toLocaleString()}
              </span>
              over
            </span>
          ) : (
            <span className="mt-1.5 text-xs font-semibold text-jade-700 dark:text-jade-400">
              <span className="font-display tabular-nums">
                {Math.round(remaining).toLocaleString()}
              </span>
              {' left'}
            </span>
          )}
        </div>
      </div>

      {/* Legend — identity is never carried by color alone. */}
      <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {LEGEND.map(({ key, label, swatch }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${swatch}`} aria-hidden="true" />
            <span className="text-xs font-medium text-stone-600 dark:text-stone-400">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
