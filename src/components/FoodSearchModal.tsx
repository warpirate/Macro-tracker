import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X, Camera, Plus, Minus, Info, Clock, Star, Loader2, Globe, AlertCircle } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { Food, MealType, FoodCategory } from '../types'
import { FOOD_DATABASE, searchFoods } from '../data/foodDatabase'
import { useStore } from '../store/useStore'
import { NutritionLabel } from './NutritionLabel'
import { searchUSDA, USDAFood } from '../utils/usdaApi'

interface FoodSearchModalProps {
  date: string
  mealType: MealType
  onClose: () => void
}

/** Placeholder row for the loading state — shimmer, never a bare spinner. */
const Shimmer: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden="true"
    className={`animate-shimmer rounded-lg bg-stone-200 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] dark:bg-stone-800 dark:from-stone-800 dark:via-stone-700 dark:to-stone-800 ${className ?? ''}`}
  />
)

const SkeletonRow: React.FC = () => (
  <div className="card p-3">
    <Shimmer className="h-4 w-2/5" />
    <Shimmer className="mt-2 h-3 w-1/4" />
    <div className="mt-3 flex items-end justify-between gap-3">
      <div className="flex gap-1.5">
        <Shimmer className="h-6 w-14 rounded-full" />
        <Shimmer className="h-6 w-14 rounded-full" />
        <Shimmer className="h-6 w-14 rounded-full" />
      </div>
      <Shimmer className="h-6 w-12" />
    </div>
  </div>
)

/**
 * Macro chip. The hue is carried by a swatch that reads the macro CSS variable, so it
 * is correct in both themes, and the letter next to it labels the macro directly —
 * identity never rests on color alone.
 */
const MacroChip: React.FC<{ label: string; grams: number; swatch: string }> = ({
  label,
  grams,
  swatch,
}) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-100 px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-800">
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${swatch}`} aria-hidden="true" />
    <span className="font-medium text-stone-600 dark:text-stone-400">{label}</span>
    <span className="font-display font-semibold tabular-nums text-stone-900 dark:text-stone-100">
      {grams.toFixed(1)}
    </span>
    <span className="text-stone-500 dark:text-stone-500">g</span>
  </span>
)

interface FoodRowProps {
  food: Food
  selected: boolean
  servings: string
  sourceLabel?: string
  onToggle: () => void
  onShowNutrition: () => void
  onServingsChange: (value: string) => void
  onAdd: () => void
}

const FoodRow: React.FC<FoodRowProps> = ({
  food,
  selected,
  servings,
  sourceLabel,
  onToggle,
  onShowNutrition,
  onServingsChange,
  onAdd,
}) => (
  <div
    className={`card relative transition-colors duration-150 ${
      selected
        ? 'border-jade-500 bg-jade-50 ring-1 ring-jade-500 dark:border-jade-500 dark:bg-jade-900/20'
        : 'hover:border-stone-300 dark:hover:border-stone-700'
    }`}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="w-full rounded-2xl p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950"
    >
      <p className="truncate pr-12 font-semibold text-stone-900 dark:text-stone-100">{food.name}</p>
      <p className="mt-0.5 truncate pr-12 text-xs text-stone-500 dark:text-stone-400">
        {food.brand ? `${food.brand} · ` : ''}
        <span className="font-display tabular-nums">{food.servingSize}</span>
        {food.servingUnit}
        {sourceLabel ? (
          <>
            {' · '}
            <span className="font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">
              {sourceLabel}
            </span>
          </>
        ) : null}
      </p>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <MacroChip label="P" grams={food.protein} swatch="bg-macro-protein" />
          <MacroChip label="C" grams={food.carbs} swatch="bg-macro-carbs" />
          <MacroChip label="F" grams={food.fat} swatch="bg-macro-fat" />
        </div>
        <p className="shrink-0 text-right leading-none">
          <span className="stat-value text-xl">{food.calories}</span>
          <span className="stat-label ml-1">kcal</span>
        </p>
      </div>
    </button>

    <button
      type="button"
      onClick={onShowNutrition}
      aria-label={`Nutrition facts for ${food.name}`}
      className="btn-icon absolute right-1.5 top-1.5"
    >
      <Info className="h-4 w-4" aria-hidden="true" />
    </button>

    {selected && (
      <div className="animate-fade-in flex flex-wrap items-center gap-2 border-t border-stone-200 px-3 py-3 dark:border-stone-800">
        <button
          type="button"
          onClick={() => onServingsChange(String(Math.max(0.25, parseFloat(servings) - 0.25)))}
          aria-label="Decrease servings"
          className="btn-icon border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-800"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="number"
          value={servings}
          onChange={e => onServingsChange(e.target.value)}
          aria-label="Servings"
          min="0.25"
          step="0.25"
          className="input-field w-16 px-1 text-center font-display font-semibold tabular-nums"
        />
        <button
          type="button"
          onClick={() => onServingsChange(String(parseFloat(servings) + 0.25))}
          aria-label="Increase servings"
          className="btn-icon border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-800"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="text-xs text-stone-500 dark:text-stone-400">servings</span>
        <button type="button" onClick={onAdd} className="btn-primary ml-auto px-4">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </button>
      </div>
    )}
  </div>
)

export const FoodSearchModal: React.FC<FoodSearchModalProps> = ({ date, mealType, onClose }) => {
  const [query, setQuery] = useState('')
  const [selectedFood, setSelectedFood] = useState<Food | null>(null)
  const [showNutrition, setShowNutrition] = useState<Food | null>(null)
  const [servings, setServings] = useState('1')
  const [activeTab, setActiveTab] = useState<'search' | 'recent' | 'custom'>('search')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const [barcodeError, setBarcodeError] = useState('')
  const [showBarcodePanel, setShowBarcodePanel] = useState(false)
  const [usdaResults, setUsdaResults] = useState<USDAFood[]>([])
  const [usdaLoading, setUsdaLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const barcodeFileRef = useRef<HTMLInputElement>(null)
  const usdaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const addFoodEntry = useStore(s => s.addFoodEntry)
  const recentFoodIds = useStore(s => s.recentFoodIds)
  const customFoods = useStore(s => s.customFoods)
  const updateStreak = useStore(s => s.updateStreak)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced USDA search — fires 600ms after user stops typing (only on search tab)
  useEffect(() => {
    if (activeTab !== 'search' || query.trim().length < 2) {
      setUsdaResults([])
      return
    }
    if (usdaTimerRef.current) clearTimeout(usdaTimerRef.current)
    usdaTimerRef.current = setTimeout(async () => {
      setUsdaLoading(true)
      try {
        const res = await searchUSDA(query, 10)
        // Filter out items already in local results to avoid duplicates
        setUsdaResults(res)
      } catch {
        setUsdaResults([])
      } finally {
        setUsdaLoading(false)
      }
    }, 600)
    return () => { if (usdaTimerRef.current) clearTimeout(usdaTimerRef.current) }
  }, [query, activeTab])

  const results = useMemo(() => {
    if (activeTab === 'recent') {
      return recentFoodIds
        .map(id => [...FOOD_DATABASE, ...customFoods].find(f => f.id === id))
        .filter(Boolean) as Food[]
    }
    if (activeTab === 'custom') return customFoods
    return searchFoods(query, 30)
  }, [query, activeTab, recentFoodIds, customFoods])

  const lookupBarcode = async (code: string) => {
    if (!code.trim()) return
    setBarcodeLoading(true)
    setBarcodeError('')
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code.trim()}.json`)
      const data = await res.json()
      if (data.status !== 1 || !data.product) {
        setBarcodeError('Product not found. Try searching by name.')
        return
      }
      const p = data.product
      const n = p.nutriments ?? {}
      const serving = parseFloat(p.serving_quantity) || 100
      const food: Food = {
        id: `barcode_${uuidv4()}`,
        name: p.product_name || p.product_name_en || 'Unknown Product',
        brand: p.brands || undefined,
        category: 'Custom' as FoodCategory,
        servingSize: serving,
        servingUnit: p.serving_size?.replace(/[\d.]/g, '').trim() || 'g',
        calories:     Math.round(n['energy-kcal_serving'] ?? ((n['energy-kcal_100g'] ?? 0) * serving / 100)),
        protein:      +(n['proteins_serving']      ?? ((n['proteins_100g']      ?? 0) * serving / 100)).toFixed(1),
        carbs:        +(n['carbohydrates_serving']  ?? ((n['carbohydrates_100g'] ?? 0) * serving / 100)).toFixed(1),
        fat:          +(n['fat_serving']            ?? ((n['fat_100g']           ?? 0) * serving / 100)).toFixed(1),
        fiber:        +(n['fiber_serving']          ?? ((n['fiber_100g']         ?? 0) * serving / 100)).toFixed(1),
        sugar:        +(n['sugars_serving']         ?? ((n['sugars_100g']        ?? 0) * serving / 100)).toFixed(1),
        sodium:       Math.round((n['sodium_serving'] ?? ((n['sodium_100g'] ?? 0) * serving / 100)) * 1000),
        potassium: 0, cholesterol: 0, saturatedFat: 0, transFat: 0,
        vitaminA: 0, vitaminC: 0, calcium: 0, iron: 0,
        isCustom: true,
      }
      setSelectedFood(food)
      setShowBarcodePanel(false)
      setBarcodeInput('')
    } catch {
      setBarcodeError('Network error. Check your connection.')
    } finally {
      setBarcodeLoading(false)
    }
  }

  const handleBarcodeImage = async (file: File) => {
    // Try BarcodeDetector API (Chrome/Android), fall back gracefully
    if (!('BarcodeDetector' in window)) {
      setBarcodeError('Live scanning not supported on this browser. Enter the barcode number manually.')
      return
    }
    setBarcodeLoading(true)
    try {
      // @ts-expect-error BarcodeDetector not in TS lib yet
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
      const bitmap = await createImageBitmap(file)
      const codes = await detector.detect(bitmap)
      if (codes.length === 0) {
        setBarcodeError('No barcode detected. Enter the number manually.')
      } else {
        await lookupBarcode(codes[0].rawValue)
      }
    } catch {
      setBarcodeError('Could not read barcode. Enter the number manually.')
    } finally {
      setBarcodeLoading(false)
    }
  }

  const handleAdd = () => {
    if (!selectedFood) return
    const numServings = parseFloat(servings) || 1
    addFoodEntry(date, {
      foodId: selectedFood.id,
      food: selectedFood,
      servings: numServings,
      mealType,
    })
    updateStreak()
    setSelectedFood(null)
    setServings('1')
    setQuery('')
    inputRef.current?.focus()
  }

  if (showNutrition) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <div className="modal-backdrop absolute inset-0 bg-stone-950/60" onClick={() => setShowNutrition(null)} />
        <div className="animate-slide-up relative mx-auto w-full overflow-hidden p-4 sm:max-w-sm sm:rounded-2xl">
          <NutritionLabel food={showNutrition} servings={1} onClose={() => setShowNutrition(null)} />
        </div>
      </div>
    )
  }

  const showUsdaSection = activeTab === 'search' && query.trim().length >= 2
  const listIsEmpty = results.length === 0 && usdaResults.length === 0 && !usdaLoading

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="modal-backdrop absolute inset-0 bg-stone-950/60" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Add food to ${mealType}`}
        className="animate-slide-up relative flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:shadow-none sm:h-auto sm:max-h-[86vh] sm:max-w-lg sm:rounded-2xl"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-stone-200 px-4 pb-3 pt-3 dark:border-stone-800">
          <div className="mb-3 flex items-center gap-2">
            <button onClick={onClose} className="btn-icon" aria-label="Close food search">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <h2 className="section-title mb-0 flex-1 truncate capitalize">Add to {mealType}</h2>
            <button
              className="btn-icon"
              aria-label="Scan barcode"
              title="Scan barcode"
              aria-expanded={showBarcodePanel}
              onClick={() => { setShowBarcodePanel(v => !v); setBarcodeError('') }}
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Barcode panel */}
          {showBarcodePanel && (
            <div className="animate-fade-in mb-3 space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-800/40">
              <p className="stat-label">Barcode / UPC</p>
              <div className="flex gap-2">
                <input
                  value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && lookupBarcode(barcodeInput)}
                  placeholder="Enter barcode number…"
                  aria-label="Barcode or UPC number"
                  className="input-field flex-1 font-display tabular-nums"
                />
                <button
                  onClick={() => lookupBarcode(barcodeInput)}
                  disabled={barcodeLoading}
                  className="btn-primary px-4"
                >
                  {barcodeLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Go'}
                </button>
              </div>
              <input
                ref={barcodeFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleBarcodeImage(f); e.target.value = '' }}
              />
              <button onClick={() => barcodeFileRef.current?.click()} className="btn-secondary w-full">
                <Camera className="h-4 w-4" aria-hidden="true" /> Scan with Camera
              </button>
              {barcodeError && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 text-xs font-semibold text-[#B91C1C] dark:text-[#F87171]"
                >
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{barcodeError}</span>
                </p>
              )}
            </div>
          )}

          {/* Search bar */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search foods..."
              aria-label="Search foods"
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveTab('search') }}
              className="input-field pl-9 pr-12"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="btn-icon absolute right-0.5 top-1/2 h-10 w-10 -translate-y-1/2"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="mt-3 flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
            {(['search', 'recent', 'custom'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-pressed={activeTab === tab}
                className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold capitalize transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-500 ${
                  activeTab === tab
                    ? 'bg-jade-600 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-700'
                }`}
              >
                {tab === 'recent' && <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                {tab === 'custom' && <Star className="h-3.5 w-3.5" aria-hidden="true" />}
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Food list */}
        <div className="flex-1 space-y-2 overflow-y-auto bg-stone-50 px-4 py-3 dark:bg-stone-950 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
          {listIsEmpty && (
            <div className="py-12 text-center">
              <Search
                className="mx-auto mb-3 h-10 w-10 text-stone-300 dark:text-stone-700"
                aria-hidden="true"
              />
              <p className="font-display text-base font-semibold text-stone-700 dark:text-stone-300">
                No foods found
              </p>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Try a different search term</p>
            </div>
          )}

          {results.map(food => (
            <FoodRow
              key={food.id}
              food={food}
              selected={selectedFood?.id === food.id}
              servings={servings}
              onToggle={() => setSelectedFood(selectedFood?.id === food.id ? null : food)}
              onShowNutrition={() => setShowNutrition(food)}
              onServingsChange={setServings}
              onAdd={handleAdd}
            />
          ))}

          {/* USDA FoodData Central results */}
          {showUsdaSection && (
            <>
              <div className="flex items-center gap-2 pt-2">
                <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" /> USDA Database
                </span>
                <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
              </div>

              {usdaLoading && (
                <>
                  <span className="sr-only" role="status">Searching USDA…</span>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              )}

              {!usdaLoading && usdaResults.length === 0 && (
                <p className="py-3 text-center text-xs text-stone-500 dark:text-stone-400">
                  No USDA results for this query
                </p>
              )}

              {usdaResults.map(food => (
                <FoodRow
                  key={food.id}
                  food={food}
                  selected={selectedFood?.id === food.id}
                  servings={servings}
                  sourceLabel="USDA"
                  onToggle={() => setSelectedFood(selectedFood?.id === food.id ? null : food)}
                  onShowNutrition={() => setShowNutrition(food)}
                  onServingsChange={setServings}
                  onAdd={handleAdd}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
