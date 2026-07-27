import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Dumbbell, History, Plus, Search, X } from 'lucide-react'
import { Lift, LiftEquipment, MuscleGroup } from '../../types'
import { LIFT_DATABASE, searchLifts } from '../../data/exerciseDatabase'
import { useStore } from '../../store/useStore'

const MUSCLE_GROUPS: MuscleGroup[] = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Full Body',
]

const EQUIPMENT: LiftEquipment[] = [
  'Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band',
]

const chipClass = (active: boolean): string =>
  `inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950 ${
    active
      ? 'border-jade-600 bg-jade-600 text-white'
      : 'border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
  }`

interface LiftPickerProps {
  onSelect: (lift: Lift) => void
  onClose: () => void
}

/**
 * Full-screen lift chooser, same shape as FoodSearchModal so the two "pick a thing"
 * flows feel identical, rebuilt on the stone/jade tokens.
 */
export const LiftPicker: React.FC<LiftPickerProps> = ({ onSelect, onClose }) => {
  const customLifts = useStore(s => s.customLifts)
  const workoutLog = useStore(s => s.workoutLog)
  const addCustomLift = useStore(s => s.addCustomLift)

  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all')
  const [equipment, setEquipment] = useState<LiftEquipment | 'all'>('all')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMuscle, setNewMuscle] = useState<MuscleGroup>('Chest')
  const [newEquipment, setNewEquipment] = useState<LiftEquipment>('Barbell')
  const [newIsCompound, setNewIsCompound] = useState(false)
  const [nameError, setNameError] = useState('')

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const filtersActive = query.trim() !== '' || muscle !== 'all' || equipment !== 'all'

  /* Most-trained lifts first, ties broken by recency — workoutLog is newest first. */
  const frequentLifts = useMemo(() => {
    const seen = new Map<string, { lift: Lift; count: number; order: number }>()
    let order = 0
    for (const session of workoutLog) {
      for (const exercise of session.exercises ?? []) {
        if (!exercise.lift) continue
        const found = seen.get(exercise.liftId)
        if (found) found.count += 1
        else seen.set(exercise.liftId, { lift: exercise.lift, count: 1, order: order++ })
      }
    }
    return Array.from(seen.values())
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .slice(0, 6)
      .map(entry => entry.lift)
  }, [workoutLog])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Custom lifts are not in LIFT_DATABASE, so they are matched separately and listed
    // first — a lift the user created by hand is the one they were looking for.
    const custom = customLifts.filter(lift =>
      needle === '' ||
      lift.name.toLowerCase().includes(needle) ||
      lift.muscleGroup.toLowerCase().includes(needle) ||
      lift.equipment.toLowerCase().includes(needle)
    )
    const presets = searchLifts(query, LIFT_DATABASE.length)
    return [...custom, ...presets].filter(
      lift =>
        (muscle === 'all' || lift.muscleGroup === muscle) &&
        (equipment === 'all' || lift.equipment === equipment)
    )
  }, [query, muscle, equipment, customLifts])

  const handleCreate = () => {
    const name = newName.trim()
    if (name === '') {
      setNameError('Give the lift a name so you can find it again.')
      return
    }
    const lift = addCustomLift({
      name,
      muscleGroup: newMuscle,
      equipment: newEquipment,
      isCompound: newIsCompound,
    })
    onSelect(lift)
  }

  const renderLiftRow = (lift: Lift, keyPrefix: string) => (
    <button
      key={`${keyPrefix}-${lift.id}`}
      type="button"
      onClick={() => onSelect(lift)}
      className="card flex w-full min-h-[44px] items-center gap-3 p-3 text-left transition-colors duration-150 hover:border-jade-300 dark:hover:border-jade-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800">
        <Dumbbell className="h-4 w-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-stone-900 dark:text-stone-100">{lift.name}</span>
        <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
          {lift.muscleGroup} · {lift.equipment}
          {lift.isCustom ? ' · Custom' : ''}
        </span>
      </span>
      <Plus className="h-4 w-4 shrink-0 text-jade-700 dark:text-jade-400" aria-hidden="true" />
    </button>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add exercise"
      className="fixed inset-0 z-50 flex flex-col bg-stone-50 dark:bg-stone-950 animate-slide-up"
    >
      {/* Header */}
      <div className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close lift picker">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h2 className="flex-1 font-display text-lg font-semibold text-stone-900 dark:text-stone-100">
            Add exercise
          </h2>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search lifts, muscles or equipment…"
            aria-label="Search lifts"
            className="input-field pl-9 pr-11"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="btn-icon absolute right-0 top-1/2 -translate-y-1/2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            onClick={() => setMuscle('all')}
            aria-pressed={muscle === 'all'}
            className={chipClass(muscle === 'all')}
          >
            All muscles
          </button>
          {MUSCLE_GROUPS.map(group => (
            <button
              key={group}
              type="button"
              onClick={() => setMuscle(muscle === group ? 'all' : group)}
              aria-pressed={muscle === group}
              className={chipClass(muscle === group)}
            >
              {group}
            </button>
          ))}
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          <button
            type="button"
            onClick={() => setEquipment('all')}
            aria-pressed={equipment === 'all'}
            className={chipClass(equipment === 'all')}
          >
            All equipment
          </button>
          {EQUIPMENT.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setEquipment(equipment === item ? 'all' : item)}
              aria-pressed={equipment === item}
              className={chipClass(equipment === item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {creating ? (
          <div className="card space-y-3 p-4">
            <h3 className="section-title mb-0">Create a custom lift</h3>
            <div>
              <label htmlFor="custom-lift-name" className="label-text">Name</label>
              <input
                id="custom-lift-name"
                type="text"
                value={newName}
                onChange={e => { setNewName(e.target.value); setNameError('') }}
                placeholder="e.g. Reverse Nordic Curl"
                className="input-field"
              />
              {nameError !== '' && (
                <p className="mt-1.5 text-xs text-red-700 dark:text-red-400">{nameError}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="custom-lift-muscle" className="label-text">Muscle group</label>
                <select
                  id="custom-lift-muscle"
                  value={newMuscle}
                  onChange={e => setNewMuscle(e.target.value as MuscleGroup)}
                  className="input-field"
                >
                  {MUSCLE_GROUPS.map(group => <option key={group} value={group}>{group}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="custom-lift-equipment" className="label-text">Equipment</label>
                <select
                  id="custom-lift-equipment"
                  value={newEquipment}
                  onChange={e => setNewEquipment(e.target.value as LiftEquipment)}
                  className="input-field"
                >
                  {EQUIPMENT.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-stone-700 dark:text-stone-300">
              <input
                type="checkbox"
                checked={newIsCompound}
                onChange={e => setNewIsCompound(e.target.checked)}
                className="h-5 w-5 rounded border-stone-300 dark:border-stone-700 text-jade-600 focus-visible:ring-2 focus-visible:ring-jade-500"
              />
              Compound lift (moves more than one joint)
            </label>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Compound lifts step up by 2.5 kg when you hit all your reps, isolation work by 1.25 kg.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCreating(false)} className="btn-secondary flex-1">
                Back
              </button>
              <button type="button" onClick={handleCreate} className="btn-primary flex-1">
                Create and add
              </button>
            </div>
          </div>
        ) : (
          <>
            {!filtersActive && frequentLifts.length > 0 && (
              <section className="space-y-2 pb-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-500">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  Your lifts
                </h3>
                {frequentLifts.map(lift => renderLiftRow(lift, 'frequent'))}
              </section>
            )}

            {(!filtersActive && frequentLifts.length > 0) && (
              <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-500">
                All lifts
              </h3>
            )}

            {results.length === 0 ? (
              <div className="card p-6 text-center">
                <Dumbbell className="mx-auto mb-3 h-8 w-8 text-stone-300 dark:text-stone-700" aria-hidden="true" />
                <p className="font-medium text-stone-900 dark:text-stone-100">No lifts match that</p>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  Clear a filter, or add it yourself and it will be waiting next time.
                </p>
                <button
                  type="button"
                  onClick={() => { setNewName(query.trim()); setCreating(true) }}
                  className="btn-primary mt-4 w-full"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create custom lift
                </button>
              </div>
            ) : (
              results.map(lift => renderLiftRow(lift, 'all'))
            )}

            {results.length > 0 && (
              <button
                type="button"
                onClick={() => { setNewName(query.trim()); setCreating(true) }}
                className="btn-secondary mt-1 w-full"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create custom lift
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
