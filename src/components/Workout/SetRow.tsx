import React, { useEffect, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { UserProfile, WorkoutSet } from '../../types'

import { PRBadge } from './PRBadge'

export type WeightUnit = UserProfile['weightUnit']

/** What the user sees next to a weight. Storage is always kg regardless of this. */
export const weightUnitLabel = (unit: WeightUnit): string => (unit === 'lbs' ? 'lbs' : 'kg')

/** Pounds in one kilogram. */
const LBS_PER_KG = 2.20462

/** kg -> the user's unit. Display boundary only — never write the result back to state. */
export const fromKg = (kg: number, unit: WeightUnit): number =>
  unit === 'lbs' ? Math.round(kg * LBS_PER_KG * 10) / 10 : Math.round(kg * 10) / 10

/**
 * The user's unit -> kg. Everything written to WorkoutSet.weightKg goes through here.
 *
 * Deliberately does NOT use lbsToKg from calculations.ts: that helper rounds to a single
 * decimal, which is fine for a bodyweight log but loses fidelity here — 225 lb would be
 * stored as 102.1 kg and read back as "225.1 lb", so the user sees a number they never
 * typed. Three decimals round-trips every practical plate weight exactly.
 */
export const toKg = (value: number, unit: WeightUnit): number =>
  unit === 'lbs' ? Math.round((value / LBS_PER_KG) * 1000) / 1000 : Math.round(value * 10) / 10

/**
 * Column template shared by the set rows and the header above them, so the labels
 * always sit over the field they name. Both strings are static so Tailwind can see them.
 */
export const setGridClass = (showRpe: boolean): string =>
  showRpe
    ? 'grid items-center gap-1 grid-cols-[2.75rem_minmax(0,1fr)_1.5rem_minmax(0,0.7fr)_2.75rem_2.75rem_2.75rem]'
    : 'grid items-center gap-1 grid-cols-[2.75rem_minmax(0,1fr)_1.5rem_minmax(0,0.7fr)_2.75rem_2.75rem]'

const parseNumber = (text: string): number | null => {
  const cleaned = text.replace(',', '.').trim()
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value >= 0 ? value : null
}

const weightToText = (weightKg: number, unit: WeightUnit): string =>
  weightKg > 0 ? String(fromKg(weightKg, unit)) : ''

const numberInputClass =
  'input-field px-1 text-center font-display font-semibold tabular-nums text-sm'

export interface SetRowProps {
  set: WorkoutSet
  /** 1-based position inside its exercise — what the user calls "set 3". */
  index: number
  unit: WeightUnit
  showRpe: boolean
  /**
   * Progressive-overload hint in kg. Rendered as PLACEHOLDER text only: an untouched
   * suggestion must never be logged as if the user actually did it.
   */
  suggestion: { weightKg: number; reps: number } | null
  /** True once this set beats the stored personal record for its lift. */
  isPR?: boolean
  onChange: (patch: Partial<WorkoutSet>) => void
  onRemove: () => void
}

export const SetRow: React.FC<SetRowProps> = ({
  set,
  index,
  unit,
  showRpe,
  suggestion,
  isPR = false,
  onChange,
  onRemove,
}) => {
  const unitLabel = weightUnitLabel(unit)
  const [weightText, setWeightText] = useState(() => weightToText(set.weightKg, unit))
  const [repsText, setRepsText] = useState(() => (set.reps > 0 ? String(set.reps) : ''))
  const [rpeText, setRpeText] = useState(() => (set.rpe === undefined ? '' : String(set.rpe)))

  // Re-sync only when the stored value genuinely diverges from what is typed (a unit
  // switch, or an edit made elsewhere). Comparing in kg keeps rounding from fighting
  // the user mid-keystroke. `weightText` is intentionally not a dependency.
  useEffect(() => {
    const typed = parseNumber(weightText)
    const typedKg = typed === null ? 0 : toKg(typed, unit)
    if (Math.abs(typedKg - set.weightKg) > 0.05) setWeightText(weightToText(set.weightKg, unit))
  }, [set.weightKg, unit])

  useEffect(() => {
    const typed = parseNumber(repsText)
    if ((typed === null ? 0 : Math.round(typed)) !== set.reps) {
      setRepsText(set.reps > 0 ? String(set.reps) : '')
    }
  }, [set.reps])

  const handleWeight = (text: string) => {
    setWeightText(text)
    const value = parseNumber(text)
    onChange({ weightKg: value === null ? 0 : toKg(value, unit) })
  }

  const handleReps = (text: string) => {
    setRepsText(text)
    const value = parseNumber(text)
    onChange({ reps: value === null ? 0 : Math.round(value) })
  }

  const handleRpe = (text: string) => {
    setRpeText(text)
    const value = parseNumber(text)
    onChange({ rpe: value === null ? undefined : Math.min(10, Math.max(1, value)) })
  }

  // Removing a set sits one thumb-width from completing one, so a set that already
  // holds real work asks twice. An untouched set goes on the first tap.
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!confirmRemove) return
    const id = setTimeout(() => setConfirmRemove(false), 4000)
    return () => clearTimeout(id)
  }, [confirmRemove])

  const handleRemove = () => {
    if (!set.completed || confirmRemove) onRemove()
    else setConfirmRemove(true)
  }

  const canComplete = set.reps > 0
  const settled = set.completed

  return (
    <div
      className={`rounded-xl border px-1 py-1 transition-colors duration-150 ${
        settled
          ? 'border-jade-200 dark:border-jade-800 bg-jade-50 dark:bg-jade-900/20'
          : 'border-transparent'
      }`}
    >
      <div className={setGridClass(showRpe)}>
        {/* Set number doubles as the warmup toggle — a warmup reads 'W' and adds no volume. */}
        <button
          type="button"
          onClick={() => onChange({ isWarmup: !set.isWarmup })}
          aria-pressed={set.isWarmup}
          aria-label={
            set.isWarmup
              ? `Set ${index} is a warmup set. Activate to make it a working set.`
              : `Set ${index} is a working set. Activate to make it a warmup set.`
          }
          title={set.isWarmup ? 'Warmup set — tap to make it a working set' : 'Tap to mark as warmup'}
          className={`btn-icon font-display font-semibold tabular-nums text-sm ${
            set.isWarmup ? 'text-stone-500 dark:text-stone-400 italic' : 'text-stone-700 dark:text-stone-300'
          }`}
        >
          {set.isWarmup ? 'W' : index}
        </button>

        <input
          type="text"
          inputMode="decimal"
          value={weightText}
          onChange={e => handleWeight(e.target.value)}
          placeholder={suggestion && suggestion.weightKg > 0 ? String(fromKg(suggestion.weightKg, unit)) : '0'}
          aria-label={`Set ${index} weight in ${unitLabel}`}
          className={`${numberInputClass} ${settled ? 'border-transparent bg-transparent' : ''}`}
        />

        <span className="text-center text-[10px] font-medium leading-none text-stone-400 dark:text-stone-500">
          {unitLabel}
        </span>

        <input
          type="text"
          inputMode="numeric"
          value={repsText}
          onChange={e => handleReps(e.target.value)}
          placeholder={suggestion ? String(suggestion.reps) : '0'}
          aria-label={`Set ${index} reps`}
          className={`${numberInputClass} ${settled ? 'border-transparent bg-transparent' : ''}`}
        />

        {showRpe && (
          <input
            type="text"
            inputMode="decimal"
            value={rpeText}
            onChange={e => handleRpe(e.target.value)}
            placeholder="–"
            aria-label={`Set ${index} RPE, 1 to 10`}
            className={`${numberInputClass} ${settled ? 'border-transparent bg-transparent' : ''}`}
          />
        )}

        <button
          type="button"
          onClick={() => onChange({ completed: !set.completed })}
          disabled={!canComplete && !set.completed}
          aria-pressed={set.completed}
          aria-label={set.completed ? `Set ${index} completed. Activate to undo.` : `Mark set ${index} as completed`}
          title={canComplete || set.completed ? undefined : 'Enter reps first'}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950 disabled:opacity-40 ${
            set.completed
              ? 'border-jade-600 bg-jade-600 text-white hover:bg-jade-700'
              : 'border-stone-300 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800'
          }`}
        >
          <Check className="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={handleRemove}
          aria-label={confirmRemove ? `Confirm removal of set ${index}` : `Remove set ${index}`}
          title={confirmRemove ? 'Tap again to remove' : 'Remove set'}
          className={`btn-icon ${confirmRemove ? 'text-red-700 dark:text-red-400' : ''}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {confirmRemove && (
        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-red-700 dark:text-red-400">
          Tap the bin again to remove this set.
        </p>
      )}

      {isPR && !confirmRemove && (
        <div className="px-1 pb-1 pt-1.5">
          <PRBadge detail={`${fromKg(set.weightKg, unit)} ${unitLabel} × ${set.reps}`} />
        </div>
      )}
    </div>
  )
}
