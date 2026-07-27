import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Beef,
  Bookmark,
  Check,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cookie,
  Copy,
  Dumbbell,
  Edit2,
  Moon,
  Plus,
  Search,
  Sun,
  Sunrise,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Navbar } from '../components/Layout/Navbar'
import { FoodSearchModal } from '../components/FoodSearchModal'
import { RecipeBuilder } from '../components/RecipeBuilder'
import { MealType, FoodEntry } from '../types'
import { getDayNutrition, getTodayString, formatDate, getDateString } from '../utils/calculations'
import { EXERCISE_DATABASE } from '../data/foodDatabase'

const MEALS: MealType[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Pre-Workout', 'Post-Workout']

/* Same icon vocabulary as the Dashboard meal list, extended for the two workout meals. */
const MEAL_ICONS: Record<MealType, LucideIcon> = {
  Breakfast: Sunrise,
  Lunch: Sun,
  Dinner: Moon,
  Snacks: Cookie,
  'Pre-Workout': Zap,
  // Not a dumbbell: that belongs to the Exercise section further down the page, and two
  // rows carrying the same glyph read as the same thing at a glance.
  'Post-Workout': Beef,
}

/*
  Status token — docs/DESIGN-SYSTEM.md §2. Reserved for state, never a chart series, and
  always shipped alongside an icon plus a screen-reader label so it never rides on color.
  The hexes are not in the Tailwind scale on purpose, so they are the documented values.
*/
const CRITICAL_TEXT = 'text-[#B91C1C] dark:text-[#F87171]'
const GOOD_TEXT = 'text-jade-700 dark:text-jade-400'

/*
  Macro colors resolve through the CSS custom properties, so one class is correct in both
  themes. They are written doubled (`text-macro-x dark:text-macro-x`) because
  `.dark .stat-value` emits at specificity (0,2,0) in the components layer and beats a bare
  utility at (0,1,0); the `dark:` variant matches that specificity from the later utilities
  layer, so the macro hue wins in dark mode too.
*/
const MACRO_TEXT = {
  protein: 'text-macro-protein dark:text-macro-protein',
  carbs: 'text-macro-carbs dark:text-macro-carbs',
  fat: 'text-macro-fat dark:text-macro-fat',
  fiber: 'text-macro-fiber dark:text-macro-fiber',
} as const

/* Focus rings for surfaces that cannot use a .btn-* class, per surface they sit on. */
const FOCUS_RING_PAGE =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950'
const FOCUS_RING_CARD =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900'

/*
  The Navbar is `sticky top-0` and 69px tall: a 44px control row (btn-icon is h-11) plus
  py-3 above and below plus its 1px hairline. The date bar parks exactly underneath it
  instead of sliding behind it.
*/
const DATE_BAR_OFFSET = 'top-[69px]'

export const Diary: React.FC = () => {
  const [searchParams] = useSearchParams()
  const [currentDate, setCurrentDate] = useState(getTodayString())
  const [showSearch, setShowSearch] = useState(false)
  const [showRecipe, setShowRecipe] = useState(false)
  const [activeMeal, setActiveMeal] = useState<MealType>(
    (searchParams.get('meal') as MealType) || 'Breakfast'
  )
  const [showExercise, setShowExercise] = useState(false)
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set(['Breakfast', 'Lunch', 'Dinner', 'Snacks']))
  const [editingEntry, setEditingEntry] = useState<string | null>(null)
  const [editServings, setEditServings] = useState('')

  // Meal-template capture: which meal is being named, the draft name, and the last save
  // so the page can confirm it in place rather than through a browser dialog.
  const [namingMeal, setNamingMeal] = useState<MealType | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplate, setSavedTemplate] = useState<{ meal: MealType; name: string } | null>(null)

  const day = useStore(s => s.diary[currentDate] ?? { date: currentDate, entries: [], waterIntake: 0, exercises: [] })
  const goals = useStore(s => s.goals)
  const removeFoodEntry = useStore(s => s.removeFoodEntry)
  const removeExerciseEntry = useStore(s => s.removeExerciseEntry)
  const updateFoodEntry = useStore(s => s.updateFoodEntry)
  const copyDayEntries = useStore(s => s.copyDayEntries)
  const copyMealEntries = useStore(s => s.copyMealEntries)
  const mealTemplates = useStore(s => s.mealTemplates)
  const applyMealTemplate = useStore(s => s.applyMealTemplate)
  const saveMealTemplate = useStore(s => s.saveMealTemplate)
  const currentWeightKg = useStore(s => s.currentWeightKg)

  const nutrition = useMemo(() => getDayNutrition(day), [day])

  const isToday = currentDate === getTodayString()

  const weekday = useMemo(() => {
    const [year, month, date] = currentDate.split('-').map(Number)
    return new Date(year, month - 1, date).toLocaleDateString('en-US', { weekday: 'long' })
  }, [currentDate])

  // The confirmation is transient; it clears itself so it never goes stale on the page.
  useEffect(() => {
    if (!savedTemplate) return
    const timer = window.setTimeout(() => setSavedTemplate(null), 5000)
    return () => window.clearTimeout(timer)
  }, [savedTemplate])

  const navigateDate = (dir: -1 | 1) => {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() + dir)
    setCurrentDate(getDateString(d))
  }

  const toggleMeal = (meal: string) => {
    setExpandedMeals(prev => {
      const next = new Set(prev)
      if (next.has(meal)) next.delete(meal)
      else next.add(meal)
      return next
    })
  }

  const handleCopyYesterday = () => {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    copyDayEntries(getDateString(d), currentDate)
  }

  const handleCopyYesterdayMeal = (meal: MealType) => {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    copyMealEntries(getDateString(d), currentDate, meal)
  }

  const startEdit = (entry: FoodEntry) => {
    setEditingEntry(entry.id)
    setEditServings(String(entry.servings))
  }

  const saveEdit = (entryId: string) => {
    const servings = parseFloat(editServings)
    if (servings > 0) updateFoodEntry(currentDate, entryId, servings)
    setEditingEntry(null)
  }

  const startNaming = (meal: MealType) => {
    setSavedTemplate(null)
    setTemplateName('')
    setNamingMeal(meal)
  }

  const cancelNaming = () => {
    setNamingMeal(null)
    setTemplateName('')
  }

  /* The only caller of saveMealTemplate in the app — without it the template list in
     Profile and the quick-add row above can never be populated. */
  const handleSaveTemplate = (event: React.FormEvent<HTMLFormElement>, meal: MealType) => {
    event.preventDefault()
    const name = templateName.trim()
    if (!name) return
    saveMealTemplate(name, currentDate, meal)
    setNamingMeal(null)
    setTemplateName('')
    setSavedTemplate({ meal, name })
  }

  const calorieDelta = goals.calories - nutrition.calories
  const overCalories = calorieDelta < 0
  const caloriePct = Math.min(Math.max((nutrition.calories / Math.max(goals.calories, 1)) * 100, 0), 100)

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <Navbar
        title="Food Diary"
        action={
          // Below sm these collapse to 44x44 icon buttons so the page title is not
          // squeezed out of the header on a phone.
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowRecipe(true)}
              aria-label="Open the recipe builder"
              className="btn-secondary w-11 px-0 text-sm sm:w-auto sm:px-3"
            >
              <ChefHat className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Recipe</span>
            </button>
            <button
              type="button"
              onClick={handleCopyYesterday}
              aria-label="Copy every food logged yesterday into this day"
              className="btn-secondary w-11 px-0 text-sm sm:w-auto sm:px-3"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Yesterday</span>
            </button>
          </div>
        }
      />

      {/* --- Date navigator ------------------------------------------------- */}
      <div
        className={`sticky ${DATE_BAR_OFFSET} z-20 border-b border-stone-200 bg-white/90 backdrop-blur-sm dark:border-stone-800 dark:bg-stone-900/90`}
      >
        <nav
          className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2"
          aria-label="Diary date"
        >
          <button
            type="button"
            onClick={() => navigateDate(-1)}
            className="btn-icon"
            aria-label="Go to the previous day"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setCurrentDate(getTodayString())}
            aria-label={isToday ? `Showing today, ${currentDate}` : `Jump back to today. Showing ${currentDate}`}
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-xl px-2 transition-colors duration-150 hover:bg-stone-100 dark:hover:bg-stone-800 ${FOCUS_RING_CARD}`}
          >
            <span className="font-display text-base font-semibold leading-tight tracking-tight text-stone-900 dark:text-stone-100">
              {isToday ? 'Today' : formatDate(currentDate)}
            </span>
            <span className="text-xs font-medium text-stone-500 dark:text-stone-500">
              {weekday} · <span className="font-display tabular-nums">{currentDate}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigateDate(1)}
            disabled={isToday}
            className="btn-icon"
            aria-label="Go to the next day"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </nav>
      </div>

      <div className="page-container space-y-4">

        {/* --- Quick add: saved meal templates ------------------------------- */}
        {mealTemplates.length > 0 && (
          <section aria-label="Saved meal templates">
            <p className="stat-label mb-2 flex items-center gap-1.5">
              <Bookmark className="h-3.5 w-3.5" aria-hidden="true" /> Quick add
            </p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {mealTemplates.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { applyMealTemplate(t.id, currentDate) }}
                  aria-label={`Add the ${t.name} template to this day`}
                  className={`min-h-[44px] shrink-0 rounded-full border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-700 shadow-sm transition-colors duration-150 hover:border-jade-300 hover:text-jade-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:shadow-none dark:hover:border-jade-700 dark:hover:text-jade-300 ${FOCUS_RING_PAGE}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* --- Day totals ----------------------------------------------------- */}
        <section className="card p-4" aria-label="Totals for this day">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div>
              <p className="stat-label">Eaten</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className={`stat-value text-3xl ${overCalories ? CRITICAL_TEXT : ''}`}>
                  {Math.round(nutrition.calories).toLocaleString()}
                </span>
                <span className="text-sm text-stone-500 dark:text-stone-400">
                  / <span className="font-display font-semibold tabular-nums">{goals.calories.toLocaleString()}</span> kcal
                </span>
              </p>
            </div>

            <p
              className={`flex items-center gap-1.5 text-sm font-semibold ${overCalories ? CRITICAL_TEXT : GOOD_TEXT}`}
            >
              {overCalories
                ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                : <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span>
                <span className="font-display font-semibold tabular-nums">
                  {Math.round(Math.abs(calorieDelta)).toLocaleString()}
                </span>{' '}
                kcal {overCalories ? 'over goal' : 'left'}
              </span>
            </p>
          </div>

          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(caloriePct)}
            aria-label="Share of the calorie goal eaten on this day"
          >
            <div
              className={`progress-bar-fill h-full rounded-full ${overCalories ? 'bg-[#B91C1C] dark:bg-[#F87171]' : 'bg-jade-600 dark:bg-jade-500'}`}
              style={{ width: `${caloriePct}%` }}
            />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
            <SummaryCell label="Protein" value={nutrition.protein} goal={goals.protein} valueClass={MACRO_TEXT.protein} />
            <SummaryCell label="Carbs" value={nutrition.carbs} goal={goals.carbs} valueClass={MACRO_TEXT.carbs} />
            <SummaryCell label="Fat" value={nutrition.fat} goal={goals.fat} valueClass={MACRO_TEXT.fat} />
            <SummaryCell label="Fiber" value={nutrition.fiber} goal={goals.fiber} valueClass={MACRO_TEXT.fiber} />
          </div>
        </section>

        {/* --- Meal sections --------------------------------------------------- */}
        {MEALS.map(meal => {
          const entries = day.entries.filter(e => e.mealType === meal)
          const mealCals = entries.reduce((sum, e) => sum + e.food.calories * e.servings, 0)
          const isExpanded = expandedMeals.has(meal)
          const isNaming = namingMeal === meal && entries.length > 0
          const justSaved = savedTemplate?.meal === meal
          const MealIcon = MEAL_ICONS[meal]

          return (
            <section key={meal} className="card overflow-hidden" aria-label={meal}>

              {/* Meal header — the toggle and the copy control are siblings so neither
                  button is nested inside the other. */}
              <div className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={() => toggleMeal(meal)}
                  aria-expanded={isExpanded}
                  className={`flex min-h-[64px] flex-1 items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors duration-150 hover:bg-stone-50 dark:hover:bg-stone-800/60 ${FOCUS_RING_CARD}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800">
                    <MealIcon className="h-5 w-5 text-stone-600 dark:text-stone-400" aria-hidden="true" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">{meal}</span>
                    <span className="block text-xs text-stone-500 dark:text-stone-500">
                      <span className="font-display font-semibold tabular-nums">{entries.length}</span>{' '}
                      item{entries.length !== 1 ? 's' : ''}
                    </span>
                  </span>

                  {/* Per-meal calorie total — the app's visual signature. */}
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-lg font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
                      {Math.round(mealCals).toLocaleString()}
                    </span>
                    <span className="mt-1 block text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-500">
                      kcal
                    </span>
                  </span>

                  {isExpanded
                    ? <ChevronUp className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-600" aria-hidden="true" />
                    : <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-600" aria-hidden="true" />}
                </button>

                <button
                  type="button"
                  onClick={() => handleCopyYesterdayMeal(meal)}
                  className="btn-icon"
                  aria-label={`Copy yesterday's ${meal} into this day`}
                  title={`Copy yesterday's ${meal}`}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {isExpanded && (
                <div className="border-t border-stone-200 dark:border-stone-800">
                  {entries.length === 0 ? (
                    <p className="px-4 py-5 text-center text-sm text-stone-500 dark:text-stone-500">
                      Nothing logged for {meal} yet.
                    </p>
                  ) : (
                    <ul>
                      {entries.map(entry => (
                        <li
                          key={entry.id}
                          className="border-b border-stone-200 px-3 py-2.5 last:border-b-0 dark:border-stone-800"
                        >
                          {editingEntry === entry.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                                {entry.food.name}
                              </p>
                              <input
                                type="number"
                                value={editServings}
                                onChange={e => setEditServings(e.target.value)}
                                aria-label={`Servings of ${entry.food.name}`}
                                className="input-field w-20 px-2 text-center font-display font-semibold tabular-nums"
                                min="0.25"
                                step="0.25"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => saveEdit(entry.id)}
                                className="btn-primary px-3 text-sm"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingEntry(null)}
                                className="btn-secondary px-3 text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                                  {entry.food.name}
                                </p>
                                <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                                  <span className="font-display font-semibold tabular-nums">{entry.servings}</span>
                                  {' × '}
                                  <span className="font-display font-semibold tabular-nums">{entry.food.servingSize}</span>
                                  {entry.food.servingUnit}
                                </p>
                                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                  <MacroChip label="Protein" short="P" grams={entry.food.protein * entry.servings} className={MACRO_TEXT.protein} />
                                  <MacroChip label="Carbs" short="C" grams={entry.food.carbs * entry.servings} className={MACRO_TEXT.carbs} />
                                  <MacroChip label="Fat" short="F" grams={entry.food.fat * entry.servings} className={MACRO_TEXT.fat} />
                                </p>
                              </div>

                              <div className="flex shrink-0 items-center gap-0.5">
                                <p className="mr-1 text-right">
                                  <span className="block font-display text-base font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
                                    {Math.round(entry.food.calories * entry.servings).toLocaleString()}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] font-medium text-stone-500 dark:text-stone-500">
                                    kcal
                                  </span>
                                </p>
                                <button
                                  type="button"
                                  onClick={() => startEdit(entry)}
                                  className="btn-icon"
                                  aria-label={`Edit servings of ${entry.food.name}`}
                                >
                                  <Edit2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeFoodEntry(currentDate, entry.id)}
                                  className={`btn-icon ${CRITICAL_TEXT} hover:bg-stone-100 hover:text-[#B91C1C] dark:hover:bg-stone-800 dark:hover:text-[#F87171]`}
                                  aria-label={`Remove ${entry.food.name} from ${meal}`}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {justSaved && savedTemplate && (
                    <p
                      role="status"
                      className="flex items-start gap-2 border-t border-stone-200 bg-jade-50 px-4 py-3 text-sm font-semibold text-jade-700 dark:border-stone-800 dark:bg-jade-900/25 dark:text-jade-300"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Saved “{savedTemplate.name}” as a meal template. It is in Quick add at the top of
                        this page and in your profile.
                      </span>
                    </p>
                  )}

                  {isNaming ? (
                    <form
                      onSubmit={event => handleSaveTemplate(event, meal)}
                      className="border-t border-stone-200 p-4 dark:border-stone-800"
                    >
                      <label htmlFor={`template-name-${meal}`} className="label-text">
                        Name this template
                      </label>
                      <div className="flex items-start gap-2">
                        <input
                          id={`template-name-${meal}`}
                          value={templateName}
                          onChange={e => setTemplateName(e.target.value)}
                          placeholder={`e.g. ${meal} — my usual`}
                          autoFocus
                          className="input-field flex-1"
                        />
                        <button type="submit" disabled={!templateName.trim()} className="btn-primary px-4">
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelNaming}
                          className="btn-icon"
                          aria-label={`Cancel saving ${meal} as a template`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-stone-500 dark:text-stone-500">
                        Saves the{' '}
                        <span className="font-display font-semibold tabular-nums">{entries.length}</span>{' '}
                        item{entries.length !== 1 ? 's' : ''} in {meal} so you can re-add them in one tap.
                      </p>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2 border-t border-stone-200 p-2 dark:border-stone-800">
                      <button
                        type="button"
                        onClick={() => { setActiveMeal(meal); setShowSearch(true) }}
                        className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-jade-700 transition-colors duration-150 hover:bg-jade-50 dark:text-jade-400 dark:hover:bg-jade-900/25 ${FOCUS_RING_CARD}`}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add food<span className="sr-only"> to {meal}</span>
                      </button>

                      {entries.length > 0 && (
                        <button
                          type="button"
                          onClick={() => startNaming(meal)}
                          className="btn-ghost px-3 text-sm"
                        >
                          <Bookmark className="h-4 w-4" aria-hidden="true" />
                          Save as template<span className="sr-only">: {meal}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}

        {/* --- Exercise --------------------------------------------------------- */}
        <section className="card overflow-hidden" aria-label="Exercise">
          <button
            type="button"
            onClick={() => setShowExercise(!showExercise)}
            aria-expanded={showExercise}
            className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors duration-150 hover:bg-stone-50 dark:hover:bg-stone-800/60 ${FOCUS_RING_CARD}`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800">
              <Dumbbell className="h-5 w-5 text-amber-700 dark:text-amber-500" aria-hidden="true" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">Exercise</span>
              <span className="block text-xs text-stone-500 dark:text-stone-500">
                <span className="font-display font-semibold tabular-nums">{day.exercises.length}</span>{' '}
                activit{day.exercises.length !== 1 ? 'ies' : 'y'}
              </span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block font-display text-lg font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
                {nutrition.caloriesBurned > 0 ? `−${Math.round(nutrition.caloriesBurned).toLocaleString()}` : '0'}
              </span>
              <span className="mt-1 block text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-500">
                kcal
              </span>
            </span>

            {showExercise
              ? <ChevronUp className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-600" aria-hidden="true" />
              : <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-600" aria-hidden="true" />}
          </button>

          {showExercise && (
            <div className="border-t border-stone-200 dark:border-stone-800">
              {day.exercises.length > 0 && (
                <ul>
                  {day.exercises.map(ex => (
                    <li
                      key={ex.id}
                      className="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2.5 last:border-b-0 dark:border-stone-800"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                          {ex.exercise.name}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                          <span className="font-display font-semibold tabular-nums">{ex.durationMinutes}</span> min
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <p className="text-right">
                          <span className="block font-display text-base font-semibold leading-none tabular-nums text-stone-900 dark:text-stone-100">
                            −{Math.round(ex.caloriesBurned).toLocaleString()}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-medium text-stone-500 dark:text-stone-500">
                            kcal
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={() => removeExerciseEntry(currentDate, ex.id)}
                          className={`btn-icon ${CRITICAL_TEXT} hover:bg-stone-100 hover:text-[#B91C1C] dark:hover:bg-stone-800 dark:hover:text-[#F87171]`}
                          aria-label={`Remove ${ex.exercise.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <ExerciseLogger date={currentDate} weightKg={currentWeightKg} />
            </div>
          )}
        </section>
      </div>

      {showSearch && (
        <FoodSearchModal
          date={currentDate}
          mealType={activeMeal}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showRecipe && <RecipeBuilder onClose={() => setShowRecipe(false)} />}
    </div>
  )
}

/* One macro's contribution from a single entry. The short letter carries the color, the
   full word is available to assistive tech so identity never rides on the hue alone. */
const MacroChip: React.FC<{ label: string; short: string; grams: number; className: string }> = ({
  label,
  short,
  grams,
  className,
}) => (
  <span className="inline-flex items-baseline gap-1">
    <span className={`text-xs font-semibold ${className}`} aria-hidden="true">{short}</span>
    <span className="sr-only">{label}: </span>
    <span className="font-display text-xs font-semibold tabular-nums text-stone-600 dark:text-stone-300">
      {grams.toFixed(1)}
    </span>
    <span className="text-xs text-stone-500 dark:text-stone-500">g</span>
  </span>
)

const SummaryCell: React.FC<{ label: string; value: number; goal: number; valueClass: string }> = ({
  label,
  value,
  goal,
  valueClass,
}) => (
  <div className="text-center">
    <p className={`stat-value text-lg ${valueClass}`}>
      {Math.round(value).toLocaleString()}
      <span className="font-sans text-xs font-medium text-stone-500 dark:text-stone-500">g</span>
    </p>
    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-500">
      / <span className="font-display tabular-nums">{Math.round(goal).toLocaleString()}</span>g
    </p>
    <p className="stat-label mt-1">{label}</p>
  </div>
)

const ExerciseLogger: React.FC<{ date: string; weightKg: number }> = ({ date, weightKg }) => {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [duration, setDuration] = useState('30')
  const addExerciseEntry = useStore(s => s.addExerciseEntry)

  const filtered = EXERCISE_DATABASE.filter(e =>
    e.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 10)

  const handleAdd = () => {
    const ex = EXERCISE_DATABASE.find(e => e.id === selected)
    if (!ex || !duration) return
    addExerciseEntry(date, ex, parseInt(duration), weightKg)
    setSelected(''); setQuery(''); setDuration('30')
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search exercises..."
            aria-label="Search exercises"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input-field pl-9 text-sm"
          />
        </div>
        <input
          type="number"
          placeholder="Min"
          aria-label="Duration in minutes"
          value={duration}
          onChange={e => setDuration(e.target.value)}
          className="input-field w-20 px-2 text-center font-display font-semibold tabular-nums"
          min="1"
        />
      </div>

      {query && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-stone-200 p-1 dark:border-stone-800">
          {filtered.map(ex => (
            <button
              key={ex.id}
              type="button"
              onClick={() => { setSelected(ex.id); setQuery(ex.name) }}
              aria-pressed={selected === ex.id}
              className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-sm transition-colors duration-150 ${FOCUS_RING_CARD} ${
                selected === ex.id
                  ? 'bg-jade-50 text-jade-700 dark:bg-jade-900/30 dark:text-jade-300'
                  : 'text-stone-800 hover:bg-stone-100 dark:text-stone-100 dark:hover:bg-stone-800'
              }`}
            >
              <span className="truncate font-medium">{ex.name}</span>
              <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{ex.category}</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleAdd}
        disabled={!selected}
        className="btn-primary w-full"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Log Exercise
      </button>
    </div>
  )
}
