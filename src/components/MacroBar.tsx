import React from 'react'
import { AlertTriangle } from 'lucide-react'

/* Reserved critical status color — docs/DESIGN-SYSTEM.md §2. Never a macro hue,
   and always shipped alongside an icon and a text label. */
const CRITICAL_TEXT = 'text-[#B91C1C] dark:text-[#F87171]'
const CRITICAL_BG = 'bg-[#B91C1C] dark:bg-[#F87171]'

const formatAmount = (value: number) => value.toFixed(value < 10 ? 1 : 0)

interface MacroBarProps {
  label: string
  current: number
  goal: number
  unit?: string
  color: string
  bgColor: string
}

export const MacroBar: React.FC<MacroBarProps> = ({
  label, current, goal, unit = 'g', color, bgColor
}) => {
  const pct = Math.min((current / Math.max(goal, 1)) * 100, 100)
  const isOver = current > goal
  const overPct = isOver
    ? Math.min(((current - goal) / Math.max(goal, 1)) * 100, 100)
    : 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Direct label: the mark carries the macro color, the text stays legible. */}
          <span
            className={`h-2 w-2 shrink-0 rounded-full bg-current ${color}`}
            aria-hidden="true"
          />
          <span className="truncate text-xs font-medium text-stone-700 dark:text-stone-300">
            {label}
          </span>
          {isOver && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${CRITICAL_TEXT}`}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="font-display tabular-nums">
                {formatAmount(current - goal)}{unit}
              </span>
              over
            </span>
          )}
        </div>

        <span className="shrink-0 text-xs">
          <span
            className={`font-display font-semibold tabular-nums ${
              isOver ? CRITICAL_TEXT : 'text-stone-900 dark:text-stone-100'
            }`}
          >
            {formatAmount(current)}{unit}
          </span>
          <span className="font-display tabular-nums text-stone-500 dark:text-stone-500">
            {' / '}{goal}{unit}
          </span>
        </span>
      </div>

      {/* Recessive track, 4px rounded data-end, anchored to the left baseline. */}
      {/* stone-400, not stone-200: an empty track in stone-200 sits at about 1.15:1 against
          a white card and reads as a missing bar rather than an empty one. */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-stone-400 dark:bg-stone-600">
        <div
          className={`progress-bar-fill h-full rounded-full ${bgColor}`}
          style={{ width: `${pct}%` }}
        />
        {isOver && (
          <div
            className={`progress-bar-fill absolute inset-y-0 right-0 rounded-full ${CRITICAL_BG}`}
            style={{ width: `${overPct}%`, minWidth: '0.5rem' }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  )
}

interface MiniMacroProps {
  label: string
  value: number
  unit?: string
  color: string
}

export const MiniMacro: React.FC<MiniMacroProps> = ({ label, value, unit = 'g', color }) => (
  <div className="flex flex-col items-center gap-0.5">
    <div className="flex items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${color}`}
        aria-hidden="true"
      />
      <span className="font-display text-base font-semibold tabular-nums text-stone-900 dark:text-stone-100">
        {value >= 100 ? Math.round(value) : value.toFixed(1)}{unit}
      </span>
    </div>
    <span className="stat-label">{label}</span>
  </div>
)
