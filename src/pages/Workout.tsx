import React, { useMemo, useState } from 'react'
import { ChevronDown, Dumbbell, Plus, Repeat, Trash2, Trophy } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Navbar } from '../components/Layout/Navbar'
import { ActiveWorkout } from '../components/Workout/ActiveWorkout'
import { fromKg, weightUnitLabel } from '../components/Workout/SetRow'
import { WorkoutExercise, WorkoutSession } from '../types'
import {
  getPersonalRecords,
  sessionSetCount,
  sessionVolume,
} from '../utils/workoutMath'
import { formatDate, getTodayString } from '../utils/calculations'

const PR_PREVIEW_COUNT = 5

const defaultWorkoutName = (): string => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Morning workout'
  if (hour < 17) return 'Afternoon workout'
  return 'Evening workout'
}

const formatDuration = (session: WorkoutSession): string => {
  if (session.endedAt === undefined) return 'In progress'
  const minutes = Math.max(0, Math.round((session.endedAt - session.startedAt) / 60000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

interface SetGroup {
  count: number
  reps: number
  weightKg: number
}

/** Consecutive identical working sets collapse into '3 × 8 @ 100' the way a log reads. */
const groupSets = (exercise: WorkoutExercise): SetGroup[] => {
  const groups: SetGroup[] = []
  for (const set of exercise.sets ?? []) {
    if (!set.completed || set.isWarmup) continue
    const last = groups[groups.length - 1]
    if (last && last.reps === set.reps && last.weightKg === set.weightKg) last.count += 1
    else groups.push({ count: 1, reps: set.reps, weightKg: set.weightKg })
  }
  return groups
}

export const Workout: React.FC = () => {
  const workoutLog = useStore(s => s.workoutLog)
  const activeWorkoutId = useStore(s => s.activeWorkoutId)
  const workoutTemplates = useStore(s => s.workoutTemplates)
  const profile = useStore(s => s.profile)
  const startWorkout = useStore(s => s.startWorkout)
  const applyWorkoutTemplate = useStore(s => s.applyWorkoutTemplate)
  const saveWorkoutTemplate = useStore(s => s.saveWorkoutTemplate)
  const deleteWorkout = useStore(s => s.deleteWorkout)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [templateFor, setTemplateFor] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showAllRecords, setShowAllRecords] = useState(false)

  const unit = profile.weightUnit
  const unitLabel = weightUnitLabel(unit)

  const activeSession = workoutLog.find(session => session.id === activeWorkoutId) ?? null
  const history = useMemo(
    () => workoutLog.filter(session => session.id !== activeWorkoutId),
    [workoutLog, activeWorkoutId]
  )
  const records = useMemo(() => getPersonalRecords(workoutLog), [workoutLog])
  const visibleRecords = showAllRecords ? records : records.slice(0, PR_PREVIEW_COUNT)

  const handleStart = () => {
    startWorkout(defaultWorkoutName(), getTodayString())
  }

  const handleSaveTemplate = (sessionId: string) => {
    const name = templateName.trim()
    if (name === '') return
    saveWorkoutTemplate(name, sessionId)
    setTemplateFor(null)
    setTemplateName('')
  }

  const showEmptyState = activeSession === null && workoutLog.length === 0

  return (
    <>
      <Navbar title="Workout" subtitle={activeSession ? 'Session in progress' : undefined} />

      <div className="page-container space-y-4">
        {activeSession && <ActiveWorkout session={activeSession} />}

        {showEmptyState && (
          <div className="card space-y-4 p-6 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-jade-50 dark:bg-jade-900/30">
              <Dumbbell className="h-7 w-7 text-jade-700 dark:text-jade-300" aria-hidden="true" />
            </span>
            <div className="space-y-1.5">
              <h2 className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Track your first workout
              </h2>
              <p className="mx-auto max-w-sm text-sm text-stone-600 dark:text-stone-400">
                Start a session, add the lifts you are doing, then log each set as weight × reps and
                tick it off. Your volume, set count and personal records are worked out from there —
                and next time you will get a target to beat.
              </p>
            </div>
            <button type="button" onClick={handleStart} className="btn-primary w-full">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Start your first workout
            </button>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Weights are logged in {unitLabel}. Change the unit any time in Profile.
            </p>
          </div>
        )}

        {!activeSession && !showEmptyState && (
          <div className="card space-y-3 p-4">
            <div>
              <h2 className="section-title mb-1">Ready to train?</h2>
              <p className="text-sm text-stone-600 dark:text-stone-400">
                Pick up where you left off — every lift remembers what you did last time.
              </p>
            </div>
            <button type="button" onClick={handleStart} className="btn-primary w-full">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Start workout
            </button>
          </div>
        )}

        {!activeSession && workoutTemplates.length > 0 && (
          <section>
            <h2 className="section-title">Quick start</h2>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {workoutTemplates.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyWorkoutTemplate(template.id, getTodayString())}
                  className="btn-secondary shrink-0"
                >
                  <Repeat className="h-4 w-4" aria-hidden="true" />
                  {template.name}
                  <span className="font-display text-xs font-semibold tabular-nums text-stone-500 dark:text-stone-400">
                    {template.liftIds.length}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {records.length > 0 && (
          <section>
            <h2 className="section-title flex items-center gap-2">
              <Trophy className="h-4 w-4 text-jade-700 dark:text-jade-400" aria-hidden="true" />
              Personal records
            </h2>
            <div className="card divide-y divide-stone-200 dark:divide-stone-800">
              {visibleRecords.map(record => (
                <div key={record.liftId} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-stone-900 dark:text-stone-100">
                      {record.liftName}
                    </p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                      Best set{' '}
                      <span className="font-display font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                        {fromKg(record.bestWeightKg, unit)}
                      </span>
                      {` ${unitLabel}`}
                      {record.achievedOn !== '' && ` · ${formatDate(record.achievedOn)}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="stat-value text-lg">{fromKg(record.bestEstimated1RM, unit)}</p>
                    <p className="stat-label">est. 1RM {unitLabel}</p>
                  </div>
                </div>
              ))}
            </div>
            {records.length > PR_PREVIEW_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllRecords(value => !value)}
                className="btn-ghost mt-1 w-full"
              >
                {showAllRecords ? 'Show top records only' : `Show all ${records.length} records`}
              </button>
            )}
          </section>
        )}

        {history.length > 0 && (
          <section>
            <h2 className="section-title">History</h2>
            <div className="space-y-2">
              {history.map(session => {
                const expanded = expandedId === session.id
                const exercises = session.exercises ?? []
                return (
                  <div key={session.id} className="card overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : session.id)}
                      aria-expanded={expanded}
                      aria-controls={`workout-detail-${session.id}`}
                      className="flex w-full min-h-[44px] items-center gap-3 p-3 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-stone-900 dark:text-stone-100">
                          {session.name}
                        </span>
                        <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                          {formatDate(session.date)} ·{' '}
                          <span className="font-display font-semibold tabular-nums">
                            {sessionSetCount(session)}
                          </span>
                          {sessionSetCount(session) === 1 ? ' set · ' : ' sets · '}
                          <span className="font-display font-semibold tabular-nums">
                            {formatDuration(session)}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="stat-value block text-lg">
                          {Math.round(fromKg(sessionVolume(session), unit)).toLocaleString()}
                        </span>
                        <span className="stat-label block">{unitLabel} volume</span>
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500 transition-transform duration-150 ${
                          expanded ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>

                    {expanded && (
                      <div
                        id={`workout-detail-${session.id}`}
                        className="space-y-3 border-t border-stone-200 dark:border-stone-800 p-3"
                      >
                        {exercises.length === 0 ? (
                          <p className="text-sm text-stone-500 dark:text-stone-400">
                            No exercises were logged in this session.
                          </p>
                        ) : (
                          exercises.map(exercise => {
                            const groups = groupSets(exercise)
                            return (
                              <div key={exercise.id}>
                                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                                  {exercise.lift.name}
                                </p>
                                <p className="text-xs text-stone-500 dark:text-stone-400">
                                  {groups.length === 0
                                    ? 'No completed sets'
                                    : groups.map((group, index) => (
                                        <span key={index}>
                                          {index > 0 && ' · '}
                                          <span className="font-display font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                                            {group.count}
                                          </span>
                                          {' × '}
                                          <span className="font-display font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                                            {group.reps}
                                          </span>
                                          {group.weightKg > 0 && (
                                            <>
                                              {' @ '}
                                              <span className="font-display font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                                                {fromKg(group.weightKg, unit)}
                                              </span>
                                              {` ${unitLabel}`}
                                            </>
                                          )}
                                        </span>
                                      ))}
                                </p>
                              </div>
                            )
                          })
                        )}

                        {templateFor === session.id ? (
                          <div className="space-y-2">
                            <label htmlFor={`template-name-${session.id}`} className="label-text">
                              Template name
                            </label>
                            <input
                              id={`template-name-${session.id}`}
                              type="text"
                              value={templateName}
                              onChange={e => setTemplateName(e.target.value)}
                              placeholder="e.g. Push day"
                              className="input-field"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setTemplateFor(null)}
                                className="btn-secondary flex-1"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveTemplate(session.id)}
                                disabled={templateName.trim() === ''}
                                className="btn-primary flex-1"
                              >
                                Save template
                              </button>
                            </div>
                          </div>
                        ) : confirmDeleteId === session.id ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="btn-secondary flex-1"
                            >
                              Keep it
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                deleteWorkout(session.id)
                                setConfirmDeleteId(null)
                              }}
                              className="btn-ghost flex-1 text-red-700 dark:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Delete for good
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setTemplateFor(session.id)
                                setTemplateName(session.name)
                              }}
                              disabled={exercises.length === 0}
                              className="btn-secondary flex-1"
                            >
                              <Repeat className="h-4 w-4" aria-hidden="true" />
                              Save as template
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(session.id)}
                              aria-label={`Delete ${session.name} from ${formatDate(session.date)}`}
                              className="btn-icon"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
