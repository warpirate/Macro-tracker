/**
 * Which vision model actually recognises the food our users eat?
 *
 * Public benchmarks (Nutrition5k and friends) are Western plates. None of them tells us
 * whether a model can tell set dosa from uttapam, so this runs OUR photos through the SAME
 * analyser production uses (api/_photo.ts) and scores each model on them.
 *
 * USAGE
 *   1. Put meal photos in a folder, e.g. eval/photos/lunch-1.jpg
 *   2. Beside them, eval/photos/truth.json, listing what was really eaten. Use a catalog id
 *      or just the dish name as you'd search it in the app:
 *        [{ "file": "lunch-1.jpg", "meal": "Lunch",
 *           "foods": [{ "food": "sadam", "servings": 2 }, { "food": "sambar", "servings": 1 }] }]
 *   3. Set the keys for the providers you want to compare, then:
 *        NEBIUS_API_KEY=... GEMINI_API_KEY=... npx tsx scripts/eval-photos.ts eval/photos
 *
 * Providers without a key are skipped. Add or swap models in MODELS below.
 *
 * SCORES
 *   dish recall     share of the truly-eaten dishes the model found (by catalog id)
 *   extra dishes    dishes it reported that were not there
 *   kcal error      |predicted - true| for the whole plate, and as a percentage
 *   seconds         wall time per photo
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { analyzeMealPhoto, NO_THINKING } from '../api/_photo'
import { getFoodById, searchFoods } from '../src/data/foodDatabase'

interface ModelUnderTest {
  label: string
  model: string
  baseURL: string
  keyEnv: string
}

const NEBIUS = 'https://api.tokenfactory.nebius.com/v1'

/*
  Candidates. Nebius retires models without notice: Qwen2.5-VL-72B, the production default
  until 2026-09, vanished from its catalog and photo logging 404'd. List what it serves now
  with GET {NEBIUS}/models; not every model there accepts images, and this script is how you
  find out which ones do.
*/
const MODELS: ModelUnderTest[] = [
  ...[
    'moonshotai/Kimi-K3',
    'moonshotai/Kimi-K2.6',
    'google/gemma-3-27b-it',
    'openbmb/MiniCPM-V-4_5',
    // Qwen3.5-397B and Qwen3.8-27B are listed too, but reject image input outright.
  ].map(model => ({ label: model, model, baseURL: NEBIUS, keyEnv: 'NEBIUS_API_KEY' })),
  // Gemini speaks the OpenAI protocol at this base URL, so the same client works.
  {
    label: 'gemini-3.1-flash-lite',
    model: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyEnv: 'GEMINI_API_KEY',
  },
]

interface TruthFood {
  food: string
  servings: number
}

interface TruthPhoto {
  file: string
  meal?: string
  foods: TruthFood[]
}

/** Resolves "in043" or "idli" to a catalog food, the way a person searching would. */
const resolve = (food: string) => getFoodById(food) ?? searchFoods(food, 1)[0]

const mimeFor = (file: string): string => {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

const main = async (): Promise<void> => {
  const dir = process.argv[2]
  if (!dir) {
    console.error('usage: npx tsx scripts/eval-photos.ts <folder with photos and truth.json>')
    process.exit(1)
  }

  const truth: TruthPhoto[] = JSON.parse(await readFile(path.join(dir, 'truth.json'), 'utf8'))

  // Show how every truth name resolved, so a typo is caught before it skews the scores.
  console.log('\nTruth, as resolved against the catalog:')
  const resolved = truth.map(photo => {
    const foods = photo.foods.map(item => {
      const food = resolve(item.food)
      if (!food) throw new Error(`${photo.file}: "${item.food}" is not in the catalog`)
      return { food, servings: item.servings }
    })
    const kcal = foods.reduce((sum, f) => sum + f.food.calories * f.servings, 0)
    console.log(`  ${photo.file}: ${foods.map(f => `${f.servings} × ${f.food.name}`).join(', ')} = ${Math.round(kcal)} kcal`)
    return { ...photo, ids: new Set(foods.map(f => f.food.id)), kcal }
  })

  const summary: string[] = []

  for (const m of MODELS) {
    const key = process.env[m.keyEnv]
    if (!key) {
      console.log(`\n[skip] ${m.label}: ${m.keyEnv} not set`)
      continue
    }
    const client = new OpenAI({ apiKey: key, baseURL: m.baseURL })
    console.log(`\n=== ${m.label} ===`)

    let found = 0
    let expected = 0
    let extra = 0
    let absError = 0
    let pctError = 0
    let seconds = 0
    let failures = 0

    for (const photo of resolved) {
      const image = await readFile(path.join(dir, photo.file))
      const url = `data:${mimeFor(photo.file)};base64,${image.toString('base64')}`
      const started = Date.now()
      try {
        // Nebius gets the same no-thinking switch production sends; Gemini's endpoint would
        // reject a field it does not know.
        const extraBody = m.baseURL === NEBIUS ? NO_THINKING : {}
        const foods = await analyzeMealPhoto(client, m.model, url, photo.meal, { timeout: 60_000, maxRetries: 0 }, extraBody)
        const took = (Date.now() - started) / 1000
        const got = new Set(foods.map(f => f.foodId).filter((id): id is string => Boolean(id)))
        const hits = [...photo.ids].filter(id => got.has(id)).length
        const kcal = foods.reduce((sum, f) => sum + f.calories, 0)
        found += hits
        expected += photo.ids.size
        extra += foods.length - hits
        absError += Math.abs(kcal - photo.kcal)
        pctError += Math.abs(kcal - photo.kcal) / Math.max(1, photo.kcal)
        seconds += took
        console.log(
          `  ${photo.file}: ${hits}/${photo.ids.size} dishes, ${Math.round(kcal)} vs ${Math.round(photo.kcal)} kcal, ${took.toFixed(1)}s` +
            `\n    saw: ${foods.map(f => `${f.servings} × ${f.name}${f.foodId ? '' : ' (estimate)'}`).join(', ') || 'nothing'}`,
        )
      } catch (err) {
        failures += 1
        console.log(`  ${photo.file}: FAILED ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const done = resolved.length - failures
    if (done === 0) {
      summary.push(`${m.label.padEnd(28)} every photo failed`)
      continue
    }
    summary.push(
      `${m.label.padEnd(28)} recall ${(100 * found / Math.max(1, expected)).toFixed(0).padStart(3)}%` +
        `  extra ${String(extra).padStart(3)}` +
        `  kcal err ${Math.round(absError / done).toString().padStart(4)} (${(100 * pctError / done).toFixed(0)}%)` +
        `  ${(seconds / done).toFixed(1)}s/photo` +
        (failures ? `  ${failures} failed` : ''),
    )
  }

  console.log(`\n=== SUMMARY (${resolved.length} photos) ===`)
  for (const line of summary) console.log(line)
}

void main()
