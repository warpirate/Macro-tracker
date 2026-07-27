import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Dumbbell, Gauge, Plus, Timer, Trash2, X } from 'lucide-react'
import { Lift, WorkoutExercise, WorkoutSession, WorkoutSet } from '../../types'
import { useStore } from '../../store/useStore'
import {
  epley1RM,
  exerciseVolume,
  getPersonalRecords,
  sessionSetCount,
  sessionVolume,
  suggestNextSet,
} from '../../utils/workoutMath'
import { LiftPicker } from './LiftPicker'
import { SetRow, fromKg, setGridClass, weightUnitLabel } from './SetRow'

const pad = (value: number): string => String(value).padStart(2, '0')

/** H:MM:SS once past an hour, MM:SS before it. */
const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

const columnLabelClass =
  'text-center text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-500'

interface ActiveWorkoutProps {
  session: WorkoutSession
}

/**
 * The logger. Everything here writes through the store immediately — a phone that
 * dies mid-session loses nothing, and weights are converted to kg on the way in.
 */
export const ActiveWorkout: React.FC<ActiveWorkoutProps> = ({ session }) => {
  const profile = useStore(s => s.profile)
  const workoutLog = useStore(s => s.workoutLog)
  const addExerciseToWorkout = useStore(s => s.addExerciseToWorkout)
  const removeExerciseFromWorkout = useStore(s => s.removeExerciseFromWorkout)
  const addSet = useStore(s => s.addSet)
  const updateSet = useStore(s => s.updateSet)
  const removeSet = useStore(s => s.removeSet)
  const endWorkout = useStore(s => s.endWorkout)
  const cancelWorkout = useStore(s => s.cancelWorkout)

  const unit = profile.weightUnit
  const unitLabel = weightUnitLabel(unit)

  const [picking, setPicking] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [rpeExerciseIds, setRpeExerciseIds] = useState<string[]>([])
  const [name, setName] = useState(session.name)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setName(session.name)
  }, [session.id])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // There is no rename action in the store contract, and the header name has to be
  // editable, so this writes the one field directly through zustand's own setState.
  const renameWorkout = (value: string) => {
    setName(value)
    useStore.setState({
      workoutLog: useStore
        .getState()
        .workoutLog.map(entry => (entry.id === session.id ? { ...entry, name: value } : entry)),
    })
  }

  const exercises = session.exercises ?? []
  const volumeKg = sessionVolume(session)
  const setCount = sessionSetCount(session)
  const hasCompletedSets = exercises.some(ex => (ex.sets ?? []).some(set => set.completed))

  /* Records from every OTHER session — comparing against a log that already contains
     this session would mean every set ties its own record and nothing reads as a PR. */
  const priorRecords = useMemo(() => {
    const map = new Map<string, number>()
    for (const record of getPersonalRecords(workoutLog.filter(entry => entry.id !== session.id))) {
      map.set(record.liftId, record.bestEstimated1RM)
    }
    return map
  }, [workoutLog, session.id])

  /* Only the single best qualifying set per exercise wears the badge — three PR rows
     in a row would turn the celebration into noise. */
  const prSetIds = useMemo(() => {
    const ids = new Set<string>()
    for (const exercise of exercises) {
      const best1RM = priorRecords.get(exercise.liftId)
      if (best1RM === undefined) continue
      let winner: { id: string; oneRM: number } | null = null
      for (const set of exercise.sets ?? []) {
        if (!set.completed || set.isWarmup || set.weightKg <= 0 || set.reps <= 0) continue
        const oneRM = epley1RM(set.weightKg, set.reps)
        if (oneRM > best1RM && (winner === null || oneRM > winner.oneRM)) {
          winner = { id: set.id, oneRM }
        }
      }
      if (winner) ids.add(winner.id)
    }
    return ids
  }, [exercises, priorRecords])

  const suggestions = useMemo(() => {
    const map = new Map<string, { weightKg: number; reps: number } | null>()
    for (const exercise of exercises) {
      if (!map.has(exercise.liftId)) {
        map.set(exercise.liftId, suggestNextSet(workoutLog, exercise.liftId, exercise.lift))
      }
    }
    return map
  }, [exercises, workoutLog])

  /* A hint only: the previous set of this exercise, else the progressive-overload
     target. It is rendered as placeholder text and is never written to state. */
  const placeholderFor = (
    exercise: WorkoutExercise,
    index: number
  ): { weightKg: number; reps: number } | null => {
    const sets = exercise.sets ?? []
    for (let i = index - 1; i >= 0; i--) {
      const previous: WorkoutSet = sets[i]
      if (previous.reps > 0) return { weightKg: previous.weightKg, reps: previous.reps }
    }
    return suggestions.get(exercise.liftId) ?? null
  }

  const handleAddLift = (lift: Lift) => {
    addExerciseToWorkout(session.id, lift)
    setPicking(false)
  }

  const toggleRpe = (exerciseId: string) => {
    setRpeExerciseIds(ids =>
      ids.includes(exerciseId) ? ids.filter(id => id !== exerciseId) : [...ids, exerciseId]
    )
  }

  return (
    <div className="space-y-4">
      {/* Session header — the live numbers and the only Finish button. */}
      <div className="card space-y-4 p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={e => renameWorkout(e.target.value)}
            placeholder="Workout name"
            aria-label="Workout name"
            className="min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-2 py-1.5 font-display text-xl font-semibold text-stone-900 dark:text-stone-100 placeholder:text-stone-400 hover:border-stone-200 dark:hover:border-stone-800 focus-visible:border-jade-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500"
          />
          <span className="pill shrink-0 border-jade-200 bg-jade-50 text-jade-700 dark:border-jade-800 dark:bg-jade-900/30 dark:text-jade-300">
            <span className="h-1.5 w-1.5 rounded-full bg-jade-600 dark:bg-jade-400" aria-hidden="true" />
            Live
          </span>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="stat-value text-4xl">{Math.round(fromKg(volumeKg, unit)).toLocaleString()}</p>
            <p className="stat-label">{unitLabel} volume</p>
          </div>
          <div className="flex gap-5 text-right">
            <div>
              <p className="stat-value text-xl">{setCount}</p>
              <p className="stat-label">Sets</p>
            </div>
            <div>
              <p className="stat-value flex items-center gap-1.5 text-xl">
                <Timer className="h-4 w-4 text-stone-400 dark:text-stone-500" aria-hidden="true" />
                {formatElapsed(Math.max(0, now - session.startedAt))}
              </p>
              <p className="stat-label">Elapsed</p>
            </div>
          </div>
        </div>

        <button type="button" onClick={endWorkout} className="btn-primary w-full">
          Finish workout
        </button>
      </div>

      {/* Exercises */}
      {exercises.length === 0 ? (
        <div className="card p-6 text-center">
          <Dumbbell className="mx-auto mb-3 h-8 w-8 text-stone-300 dark:text-stone-700" aria-hidden="true" />
          <p className="font-medium text-stone-900 dark:text-stone-100">Nothing logged yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600 dark:text-stone-400">
            Add the first lift of the session. Every set is weight × reps, ticked off as you finish it.
          </p>
          <button type="button" onClick={() => setPicking(true)} className="btn-primary mt-4 w-full">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add exercise
          </button>
        </div>
      ) : (
        exercises.map(exercise => {
          const showRpe = rpeExerciseIds.includes(exercise.id)
          const sets = exercise.sets ?? []
          const suggestion = suggestions.get(exercise.liftId) ?? null
          const liftVolume = exerciseVolume(exercise)

          return (
            <div key={exercise.id} className="card space-y-3 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-stone-900 dark:text-stone-100">
                    {exercise.lift.name}
                  </h3>
                  <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                    {exercise.lift.muscleGroup} · {exercise.lift.equipment}
                    {liftVolume > 0 && (
                      <>
                        {' · '}
                        <span className="font-display font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                          {Math.round(fromKg(liftVolume, unit)).toLocaleString()}
                        </span>
                        {` ${unitLabel}`}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => toggleRpe(exercise.id)}
                    aria-pressed={showRpe}
                    aria-label={`${showRpe ? 'Hide' : 'Show'} RPE for ${exercise.lift.name}`}
                    title={showRpe ? 'Hide RPE' : 'Track RPE'}
                    className={`btn-icon ${showRpe ? 'text-jade-700 dark:text-jade-400' : ''}`}
                  >
                    <Gauge className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeExerciseFromWorkout(session.id, exercise.id)}
                    aria-label={`Remove ${exercise.lift.name} from this workout`}
                    title="Remove exercise"
                    className="btn-icon"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <p className="text-xs text-stone-500 dark:text-stone-400">
                {suggestion === null ? (
                  'First time logging this lift — record what you actually do.'
                ) : (
                  <>
                    Target from last time{' '}
                    <span className="font-display font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                      {suggestion.weightKg > 0
                        ? `${fromKg(suggestion.weightKg, unit)} ${unitLabel} × ${suggestion.reps}`
                        : `Bodyweight × ${suggestion.reps}`}
                    </span>
                  </>
                )}
              </p>

              {/* The transparent border matches the set rows' border box so labels line up. */}
              {sets.length > 0 && (
                <div className={`${setGridClass(showRpe)} border border-transparent px-1`}>
                  <span className={columnLabelClass}>Set</span>
                  <span className={columnLabelClass}>Weight</span>
                  <span aria-hidden="true" />
                  <span className={columnLabelClass}>Reps</span>
                  {showRpe && <span className={columnLabelClass}>RPE</span>}
                  <span className={columnLabelClass}>Done</span>
                  <span aria-hidden="true" />
                </div>
              )}

              <div className="space-y-1">
                {sets.map((set, index) => (
                  <SetRow
                    key={set.id}
                    set={set}
                    index={index + 1}
                    unit={unit}
                    showRpe={showRpe}
                    suggestion={placeholderFor(exercise, index)}
                    isPR={prSetIds.has(set.id)}
                    onChange={patch => updateSet(session.id, exercise.id, set.id, patch)}
                    onRemove={() => removeSet(session.id, exercise.id, set.id)}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  addSet(session.id, exercise.id, {
                    weightKg: 0,
                    reps: 0,
                    isWarmup: false,
                    completed: false,
                  })
                }
                className="btn-secondary w-full"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add set
              </button>
            </div>
          )
        })
      )}

      {exercises.length > 0 && (
        <button type="button" onClick={() => setPicking(true)} className="btn-secondary w-full">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add exercise
        </button>
      )}

      {/* Cancel lives at the far end of the page, well away from Finish, and asks twice. */}
      <div className="pt-4">
        {confirmCancel ? (
          <div className="card space-y-3 p-3">
            <p className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-300">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400"
                aria-hidden="true"
              />
              {hasCompletedSets
                ? 'Ending here keeps the sets you already ticked off and closes the session.'
                : 'Nothing is ticked off yet, so this workout will be deleted.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="btn-secondary flex-1"
              >
                Keep training
              </button>
              <button
                type="button"
                onClick={cancelWorkout}
                className="btn-ghost flex-1 text-red-700 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {hasCompletedSets ? 'End now' : 'Delete workout'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="btn-ghost w-full text-stone-500 dark:text-stone-400"
          >
            Cancel workout
          </button>
        )}
      </div>

      {picking && <LiftPicker onSelect={handleAddLift} onClose={() => setPicking(false)} />}
    </div>
  )
}
