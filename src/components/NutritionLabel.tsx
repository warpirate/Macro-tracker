import React from 'react'
import { X } from 'lucide-react'
import { Food } from '../types'

interface NutritionLabelProps {
  food: Food
  servings?: number
  onClose?: () => void
}

export const NutritionLabel: React.FC<NutritionLabelProps> = ({ food, servings = 1, onClose }) => {
  const mult = servings

  const row = (label: string, value: number | string, unit: string = '', indent = false, bold = false) => (
    <div className={`flex justify-between py-1 text-sm ${indent ? 'pl-4' : ''} ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="font-display tabular-nums">
        {typeof value === 'number' ? (value * mult).toFixed(value < 1 ? 1 : 0) : value}{unit}
      </span>
    </div>
  )

  const dvRow = (label: string, value: number) => (
    <div className="flex justify-between py-1 pl-4 text-sm">
      <span className="text-stone-600 dark:text-stone-400">{label}</span>
      <span className="font-display font-semibold tabular-nums">{Math.round(value * mult)}%</span>
    </div>
  )

  return (
    <div className="card-flush mx-auto w-full max-w-sm">
      {/* Masthead */}
      <div className="bg-stone-900 px-4 py-3.5 text-white dark:bg-stone-950">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold leading-tight tracking-tight">{food.name}</h2>
            {food.brand && <p className="mt-0.5 text-sm text-stone-400">{food.brand}</p>}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close nutrition label"
              className="-mr-2 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-400 transition-colors duration-150 hover:bg-stone-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900 dark:focus-visible:ring-offset-stone-950"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-stone-300">
          Serving size: <span className="font-display tabular-nums">{food.servingSize}{food.servingUnit}</span>
          {servings !== 1 && (
            <span className="text-jade-400"> × <span className="font-display tabular-nums">{servings}</span></span>
          )}
        </p>
      </div>

      {/* Nutrition facts — typeset like the printed panel: heavy rules, tight hierarchy */}
      <div className="px-4 pb-4 pt-3.5 text-stone-900 dark:text-stone-100">
        <div className="mb-2 border-b-8 border-stone-900 pb-2 dark:border-stone-100">
          <p className="font-display text-2xl font-bold leading-none tracking-tight">Nutrition Facts</p>
          <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-400">
            Serving size{' '}
            <span className="font-display tabular-nums text-stone-900 dark:text-stone-100">
              {food.servingSize}{food.servingUnit}
            </span>
            {servings !== 1 && (
              <span className="font-display tabular-nums text-stone-900 dark:text-stone-100"> (×{servings})</span>
            )}
          </p>
        </div>

        <div className="mb-1 border-b-4 border-stone-900 pb-1.5 dark:border-stone-100">
          <p className="stat-label">Amount Per Serving</p>
          <div className="mt-0.5 flex items-baseline justify-between gap-3">
            <span className="font-display text-xl font-bold tracking-tight">Calories</span>
            <span className="font-display text-4xl font-bold leading-none tabular-nums">
              {Math.round(food.calories * mult)}
            </span>
          </div>
        </div>

        <div className="mb-0.5 border-b border-stone-300 pb-1 text-right dark:border-stone-700">
          <span className="stat-label">% Daily Value*</span>
        </div>

        <div className="divide-y divide-stone-200 dark:divide-stone-800">
          <div className="flex justify-between py-1">
            <span className="text-sm font-semibold">Total Fat</span>
            <span className="font-display text-sm font-semibold tabular-nums">{(food.fat * mult).toFixed(1)}g</span>
          </div>
          {dvRow('Saturated Fat', food.saturatedFat)}
          {dvRow('Trans Fat', food.transFat)}

          <div className="flex justify-between py-1">
            <span className="text-sm font-semibold">Cholesterol</span>
            <span className="font-display text-sm tabular-nums">{Math.round(food.cholesterol * mult)}mg</span>
          </div>

          <div className="flex justify-between py-1">
            <span className="text-sm font-semibold">Sodium</span>
            <span className="font-display text-sm tabular-nums">{Math.round(food.sodium * mult)}mg</span>
          </div>
          <div className="flex justify-between py-1 pl-4">
            <span className="text-sm text-stone-600 dark:text-stone-400">Potassium</span>
            <span className="font-display text-sm tabular-nums">{Math.round(food.potassium * mult)}mg</span>
          </div>

          <div className="flex justify-between py-1">
            <span className="text-sm font-semibold">Total Carbohydrate</span>
            <span className="font-display text-sm font-semibold tabular-nums">{(food.carbs * mult).toFixed(1)}g</span>
          </div>
          <div className="flex justify-between py-1 pl-4">
            <span className="text-sm text-stone-600 dark:text-stone-400">Dietary Fiber</span>
            <span className="font-display text-sm tabular-nums">{(food.fiber * mult).toFixed(1)}g</span>
          </div>
          <div className="flex justify-between py-1 pl-4">
            <span className="text-sm text-stone-600 dark:text-stone-400">Total Sugars</span>
            <span className="font-display text-sm tabular-nums">{(food.sugar * mult).toFixed(1)}g</span>
          </div>

          <div className="flex justify-between py-1">
            <span className="text-sm font-semibold">Protein</span>
            <span className="font-display text-sm font-semibold tabular-nums">{(food.protein * mult).toFixed(1)}g</span>
          </div>
        </div>

        {/* Micronutrients */}
        <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 border-t-4 border-stone-900 pt-2 text-sm dark:border-stone-100">
          <div className="flex justify-between">
            <span className="text-stone-600 dark:text-stone-400">Vitamin A</span>
            <span className="font-display font-semibold tabular-nums">{Math.round(food.vitaminA * mult)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-600 dark:text-stone-400">Vitamin C</span>
            <span className="font-display font-semibold tabular-nums">{Math.round(food.vitaminC * mult)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-600 dark:text-stone-400">Calcium</span>
            <span className="font-display font-semibold tabular-nums">{Math.round(food.calcium * mult)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-600 dark:text-stone-400">Iron</span>
            <span className="font-display font-semibold tabular-nums">{Math.round(food.iron * mult)}%</span>
          </div>
        </div>

        <p className="mt-3 border-t border-stone-200 pt-2 text-xs leading-snug text-stone-500 dark:border-stone-800">
          * % Daily Values are based on a 2,000 calorie diet.
        </p>
      </div>

      {/* Macro summary — categorical palette, every mark directly labeled */}
      <div className="grid grid-cols-3 gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3 text-center dark:border-stone-800 dark:bg-stone-950/40">
        <div>
          <p className="font-display text-lg font-semibold leading-none tabular-nums text-macro-protein">
            {(food.protein * mult).toFixed(1)}g
          </p>
          <p className="stat-label mt-1">Protein</p>
        </div>
        <div>
          <p className="font-display text-lg font-semibold leading-none tabular-nums text-macro-carbs">
            {(food.carbs * mult).toFixed(1)}g
          </p>
          <p className="stat-label mt-1">Carbs</p>
        </div>
        <div>
          <p className="font-display text-lg font-semibold leading-none tabular-nums text-macro-fat">
            {(food.fat * mult).toFixed(1)}g
          </p>
          <p className="stat-label mt-1">Fat</p>
        </div>
      </div>
    </div>
  )
}
