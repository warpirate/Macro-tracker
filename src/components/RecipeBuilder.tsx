import React, { useState, useMemo } from 'react'
import { X, Plus, Trash2, ChefHat, Check, Search } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../store/useStore'
import { FOOD_DATABASE, searchFoods } from '../data/foodDatabase'
import { Food } from '../types'

interface Ingredient {
  food: Food
  amount: number   // grams or the food's native unit × this factor
}

interface Props {
  onClose: () => void
}

export const RecipeBuilder: React.FC<Props> = ({ onClose }) => {
  const [name, setName] = useState('')
  const [servingsYield, setServingsYield] = useState(1)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [query, setQuery] = useState('')
  const [saved, setSaved] = useState(false)

  const addCustomFood = useStore(s => s.addCustomFood)
  const customFoods   = useStore(s => s.customFoods)

  const results = useMemo(() => {
    if (!query) return []
    const db = searchFoods(query, 10)
    const custom = customFoods.filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
    return [...db, ...custom].slice(0, 12)
  }, [query, customFoods])

  const addIngredient = (food: Food) => {
    setIngredients(prev => [...prev, { food, amount: food.servingSize }])
    setQuery('')
  }

  const updateAmount = (idx: number, val: string) => {
    const n = parseFloat(val)
    if (n > 0) setIngredients(prev => prev.map((ing, i) => i === idx ? { ...ing, amount: n } : ing))
  }

  const remove = (idx: number) => setIngredients(prev => prev.filter((_, i) => i !== idx))

  // Totals (for the whole recipe, then divide by yield for per-serving)
  const totals = useMemo(() => {
    return ingredients.reduce((acc, ing) => {
      const ratio = ing.amount / ing.food.servingSize
      return {
        calories: acc.calories + ing.food.calories * ratio,
        protein:  acc.protein  + ing.food.protein  * ratio,
        carbs:    acc.carbs    + ing.food.carbs     * ratio,
        fat:      acc.fat      + ing.food.fat       * ratio,
        fiber:    acc.fiber    + ing.food.fiber     * ratio,
        sugar:    acc.sugar    + ing.food.sugar     * ratio,
        sodium:   acc.sodium   + ing.food.sodium    * ratio,
      }
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 })
  }, [ingredients])

  const perServing = {
    calories: Math.round(totals.calories / Math.max(servingsYield, 1)),
    protein:  +(totals.protein  / Math.max(servingsYield, 1)).toFixed(1),
    carbs:    +(totals.carbs    / Math.max(servingsYield, 1)).toFixed(1),
    fat:      +(totals.fat      / Math.max(servingsYield, 1)).toFixed(1),
    fiber:    +(totals.fiber    / Math.max(servingsYield, 1)).toFixed(1),
    sugar:    +(totals.sugar    / Math.max(servingsYield, 1)).toFixed(1),
    sodium:   Math.round(totals.sodium / Math.max(servingsYield, 1)),
  }

  const handleSave = () => {
    if (!name.trim() || ingredients.length === 0) return
    addCustomFood({
      name: name.trim(),
      category: 'Custom',
      servingSize: 1,
      servingUnit: 'serving',
      ...perServing,
      potassium: 0, cholesterol: 0, saturatedFat: 0, transFat: 0,
      vitaminA: 0, vitaminC: 0, calcium: 0, iron: 0,
    })
    setSaved(true)
    setTimeout(onClose, 1200)
  }

  const canSave = Boolean(name.trim()) && ingredients.length > 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-50 dark:bg-stone-950 animate-slide-up">

      {/* Header */}
      <header className="shrink-0 border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-2 py-2">
          <button onClick={onClose} className="btn-icon" aria-label="Close recipe builder">
            <X className="h-5 w-5" />
          </button>
          <ChefHat className="h-5 w-5 shrink-0 text-jade-600 dark:text-jade-400" aria-hidden="true" />
          <h2 className="flex-1 font-display text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Recipe Builder
          </h2>
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-4">

          {/* Recipe name + yield */}
          <section className="card space-y-4 p-4">
            <div>
              <label htmlFor="recipe-name" className="label-text">Recipe name</label>
              <input
                id="recipe-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Chicken Fried Rice"
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="recipe-yield" className="label-text">Servings this recipe makes</label>
              <input
                id="recipe-yield"
                type="number"
                min="1"
                value={servingsYield}
                onChange={e => setServingsYield(Math.max(1, parseInt(e.target.value) || 1))}
                className="input-field w-24 text-center font-display font-semibold tabular-nums"
              />
            </div>
          </section>

          {/* Ingredient search */}
          <section className="card p-4">
            <label htmlFor="ingredient-search" className="label-text">Add ingredients</label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
                aria-hidden="true"
              />
              <input
                id="ingredient-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search foods..."
                className="input-field pl-9"
              />
            </div>
            {results.length > 0 && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-800">
                {results.map(food => (
                  <button
                    key={food.id}
                    onClick={() => addIngredient(food)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 border-b border-stone-200 px-3 py-2 text-left transition-colors duration-150 last:border-b-0 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-jade-500 dark:border-stone-800 dark:hover:bg-stone-800"
                  >
                    <span className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{food.name}</span>
                    <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                      <span className="font-display font-semibold tabular-nums">{food.calories}</span> kcal / {food.servingSize}{food.servingUnit}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Ingredient list */}
          {ingredients.length > 0 ? (
            <section className="card-flush">
              <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                <h3 className="font-display text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                  Ingredients
                </h3>
                <span className="pill">
                  <span className="font-display tabular-nums">{ingredients.length}</span> added
                </span>
              </div>
              <ul>
                {ingredients.map((ing, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 border-b border-stone-200 px-3 py-2.5 last:border-b-0 dark:border-stone-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{ing.food.name}</p>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                        <span className="font-display text-sm font-semibold tabular-nums text-stone-600 dark:text-stone-300">
                          {ing.food.servingSize > 0
                            ? Math.round(ing.food.calories * (ing.amount / ing.food.servingSize))
                            : 0}
                        </span>{' '}
                        kcal in recipe
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <input
                        type="number"
                        value={ing.amount}
                        min="0.1" step="0.1"
                        onChange={e => updateAmount(idx, e.target.value)}
                        aria-label={`Amount of ${ing.food.name} in ${ing.food.servingUnit}`}
                        className="input-field w-[4.5rem] px-2 text-center font-display font-semibold tabular-nums"
                      />
                      <span className="w-8 text-xs font-medium text-stone-500 dark:text-stone-400">{ing.food.servingUnit}</span>
                    </div>
                    <button
                      onClick={() => remove(idx)}
                      aria-label={`Remove ${ing.food.name}`}
                      className="btn-icon text-[#B91C1C] hover:bg-stone-100 hover:text-[#B91C1C] dark:text-[#F87171] dark:hover:bg-stone-800 dark:hover:text-[#F87171]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <div className="card flex flex-col items-center gap-2 px-4 py-8 text-center">
              <ChefHat className="h-6 w-6 text-stone-400 dark:text-stone-500" aria-hidden="true" />
              <p className="text-sm font-medium text-stone-700 dark:text-stone-300">No ingredients yet</p>
              <p className="max-w-xs text-xs text-stone-500 dark:text-stone-400">
                Search above and tap a food to add it. Per-serving macros appear here as you build.
              </p>
            </div>
          )}

          {/* Per-serving macros preview — the payoff */}
          {ingredients.length > 0 && (
            <section className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                  Per serving
                </h3>
                <span className="pill">
                  makes <span className="font-display tabular-nums">{servingsYield}</span>
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold leading-none tabular-nums text-stone-900 dark:text-stone-100">
                  {perServing.calories}
                </span>
                <span className="stat-label">kcal</span>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                <MacroCell label="Protein" value={String(perServing.protein)} unit="g" valueClass="text-macro-protein" />
                <MacroCell label="Carbs"   value={String(perServing.carbs)}   unit="g" valueClass="text-macro-carbs" />
                <MacroCell label="Fat"     value={String(perServing.fat)}     unit="g" valueClass="text-macro-fat" />
                <MacroCell label="Fiber"   value={String(perServing.fiber)}   unit="g" valueClass="text-macro-fiber" />
              </div>

              {/* Sugar and sodium are not in the categorical palette — neutral, directly labeled. */}
              <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-stone-200 pt-3 dark:border-stone-800">
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Sugar{' '}
                  <span className="font-display text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-200">
                    {perServing.sugar}
                  </span> g
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Sodium{' '}
                  <span className="font-display text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-200">
                    {perServing.sodium}
                  </span> mg
                </p>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Save action */}
      <footer
        className="shrink-0 border-t border-stone-200 bg-white px-4 pt-3 dark:border-stone-800 dark:bg-stone-900"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="btn-primary w-full"
          >
            {saved
              ? <Check className="h-4 w-4" aria-hidden="true" />
              : <Plus className="h-4 w-4" aria-hidden="true" />}
            {saved ? 'Saved to Custom Foods!' : 'Save Recipe as Custom Food'}
          </button>
        </div>
      </footer>
    </div>
  )
}

const MacroCell: React.FC<{ label: string; value: string; unit: string; valueClass: string }> = ({
  label,
  value,
  unit,
  valueClass,
}) => (
  <div className="rounded-xl border border-stone-200 bg-stone-50 px-1.5 py-2.5 text-center dark:border-stone-800 dark:bg-stone-800/60">
    <p className="flex items-baseline justify-center gap-0.5">
      <span className={`font-display text-base font-semibold leading-none tabular-nums ${valueClass}`}>{value}</span>
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{unit}</span>
    </p>
    <p className="stat-label mt-1">{label}</p>
  </div>
)
