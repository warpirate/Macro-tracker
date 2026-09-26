import { FOOD_DATABASE, searchFoods } from '../src/data/foodDatabase'
import type { Food, FoodCategory } from '../src/types'

/*
  The app's own food catalog, as the AI endpoints see it.

  Photo logging and the chat coach both let the model NAME a food by catalog id while the
  numbers come from the catalog row, so a logged idli carries the same calories whether it was
  searched, photographed or described in chat. Only a food the catalog lacks falls back to the
  model's own estimate.
*/

/** One line per food: `id | name | serving`. Built once; the catalog is static. */
export const CATALOG = FOOD_DATABASE.map(
  food => `${food.id} | ${food.name} | ${food.servingSize} ${food.servingUnit}`,
).join('\n')

export const BY_ID = new Map<string, Food>(FOOD_DATABASE.map(food => [food.id, food]))

const catalogLine = (food: Food): string => `${food.id} | ${food.name} | ${food.servingSize} ${food.servingUnit}`

/**
 * Everyday foods the coach can always suggest from, whatever was said: South Indian
 * breakfasts, rice and its gravies, dal, the common curries, eggs, curd, and a few staples.
 */
const STAPLE_IDS = [
  'in001', 'in014', 'in125', 'in017', 'in018', 'in019', 'in029', 'in030', 'in038', 'in039',
  'in042', 'in043', 'in045', 'in046', 'in048', 'in049', 'in050', 'in051', 'in053', 'in057',
  'in060', 'in070', 'in074', 'in081', 'in084', 'in085', 'in086', 'in087', 'in105', 'in106',
  'in107', 'in110', 'in111', 'in137', 'in139', 'in144', 'in145', 'in146', 'in147', 'in149',
  'in152', 'in155', 'f001', 'f002', 'm001', 'm009', 'd009', 'l006',
]

/** Words that name no food, so searching the catalog for them only adds noise. */
const STOP = new Set(
  ('the and for with what should have had ate eat eating some more less than this that today ' +
    'tonight yesterday dinner lunch breakfast snack snacks meal meals just also after before ' +
    'about want need can how much many why not was were did does will would could my me you ' +
    'your our its too very like log add remove change instead of in on at to a an is am are ' +
    'be been but so if or it im ok okay please thanks btw gym workout week weekly check').split(' '),
)

/**
 * The part of the catalog worth showing the model for this turn.
 *
 * The whole catalog is ~270 lines, about 4,000 tokens, and sending it every turn pushed the
 * chat model past the edge budget on two or three requests in six. What a turn can use is
 * much smaller: the foods this person eats, the everyday staples, and whatever they just
 * named ("pesarattu", "sadam", "egg dosa"), found with the same search, aliases included,
 * that the food picker uses.
 */
export const catalogFor = (message: string, usualIds: readonly string[] = [], limit = 90): string => {
  // What they just named goes first, so the limit can only ever trim staples.
  const ids = new Set<string>()
  const words = message
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w))
  const terms = [...words.slice(1).map((w, i) => `${words[i]} ${w}`), ...words]
  for (const term of terms) {
    for (const food of searchFoods(term, 4)) ids.add(food.id)
  }
  for (const id of [...usualIds, ...STAPLE_IDS]) ids.add(id)
  return [...ids]
    .map(id => BY_ID.get(id))
    .filter((food): food is Food => food !== undefined)
    .slice(0, limit)
    .map(catalogLine)
    .join('\n')
}

export const CATEGORIES: readonly FoodCategory[] = [
  'Fruits', 'Vegetables', 'Grains & Cereals', 'Dairy', 'Meat & Poultry', 'Fish & Seafood',
  'Legumes', 'Nuts & Seeds', 'Beverages', 'Snacks', 'Fast Food', 'Condiments', 'Oils & Fats',
  'Sweets & Desserts', 'Custom',
]

/** The same shape the client already parses: macros are TOTALS for `servings`. */
export interface LoggableFood {
  name: string
  servings: number
  servingSize: number
  servingUnit: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  sodium: number
  category: FoodCategory
  /** Catalog id when matched; absent when the figures are the model's own estimate. */
  foodId?: string
}

export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const nonNegative = (value: unknown): number => Math.max(0, num(value) ?? 0)

export const round1 = (value: number): number => Math.round(value * 10) / 10

/** More distinct foods than any real plate shows. */
export const MAX_ITEMS = 20

/** No single item on one plate weighs more than this. */
const MAX_ITEM_GRAMS = 1200

/**
 * Servings the model reported, clamped to something a plate can hold. A photo cannot show
 * 40 idlis, and an unbounded count is how one misread number becomes a 9,000 kcal lunch.
 *
 * The cap is by weight, not count: ten idlis is a big breakfast, ten plates of rice is not a
 * meal. `servingSize` is grams or millilitres for every catalog row, so it bounds both.
 */
export const clampServings = (value: unknown, servingSize = 100): number | null => {
  const servings = num(value)
  if (servings === null || servings <= 0) return null
  const max = Math.max(1, Math.floor(Math.min(10, MAX_ITEM_GRAMS / Math.max(1, servingSize)) * 4) / 4)
  return Math.min(max, Math.max(0.25, Math.round(servings * 4) / 4))
}

/** Scales a catalog row to `servings`, producing totals exactly as search would. */
export const fromCatalog = (food: Food, servings: number): LoggableFood => ({
  foodId: food.id,
  name: food.name,
  servings,
  servingSize: food.servingSize,
  servingUnit: food.servingUnit,
  calories: Math.round(food.calories * servings),
  protein: round1(food.protein * servings),
  carbs: round1(food.carbs * servings),
  fat: round1(food.fat * servings),
  fiber: round1(food.fiber * servings),
  sugar: round1(food.sugar * servings),
  sodium: Math.round(food.sodium * servings),
  category: food.category,
})

/** The model's own estimate, for a food the catalog does not have. Null when unusable. */
export const fromEstimate = (item: Record<string, unknown>, servings: number): LoggableFood | null => {
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (name.length === 0) return null
  const category = CATEGORIES.includes(item.category as FoodCategory)
    ? (item.category as FoodCategory)
    : 'Custom'
  return {
    name,
    servings,
    servingSize: num(item.servingSize) ?? 100,
    servingUnit: typeof item.servingUnit === 'string' && item.servingUnit ? item.servingUnit : 'g',
    calories: Math.round(nonNegative(item.calories)),
    protein: round1(nonNegative(item.protein)),
    carbs: round1(nonNegative(item.carbs)),
    fat: round1(nonNegative(item.fat)),
    fiber: round1(nonNegative(item.fiber)),
    sugar: round1(nonNegative(item.sugar)),
    sodium: Math.round(nonNegative(item.sodium)),
    category,
  }
}

