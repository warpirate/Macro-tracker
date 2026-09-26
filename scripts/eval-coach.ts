/**
 * Does the coach do the right thing, fast enough, on a realistic South Indian diary?
 *
 * Runs the real /api/chat handler (so the prompt, tools and guards are exactly what ships)
 * over fixed scenarios and checks what it DID, not how it sounded:
 *
 *   log        foods named in chat are logged, by catalog id where the catalog has them
 *   dinner     a meal suggestion comes with an offer_meal card
 *   why        a stall is explained from the diary (intake above target), no target change
 *   remember   a stated preference is saved
 *   checkin    the weekly review does NOT raise calories on a stalled cut
 *   veg        a vegetarian is never offered meat
 *
 * The model is fixed at import, so compare models one run at a time:
 *   NEBIUS_CHAT_MODEL=moonshotai/Kimi-K3 npx tsx --env-file=.env scripts/eval-coach.ts
 *
 * The handler requires a signed-in caller (api/_auth.ts). This script has no user, so it
 * runs with AI_AUTH=off unless told otherwise; the handler is imported only after that is
 * set, because the guard reads AI_AUTH when its module loads.
 */
import { CHAT_MODEL } from '../api/_nebius'
import { BY_ID } from '../api/_catalog'

// Eggs sit under Meat & Poultry in the catalog, but "vegetarian; eats eggs" allows them.
const MEAT = new Set(['Meat & Poultry', 'Fish & Seafood'])

const dayString = (back: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return d.toISOString().slice(0, 10)
}

// Twelve days of a cut that is not working because intake runs ~400 kcal over target.
const days = Array.from({ length: 12 }, (_, i) => {
  const weekend = i % 7 >= 5
  return {
    date: dayString(12 - i),
    calories: weekend ? 2700 : 2150,
    protein: weekend ? 60 : 72,
    carbs: 320,
    fat: 70,
    foods: `Breakfast: Idli ×3, Sambar, Coconut chutney; Lunch: Cooked white rice ×2, Sambar, Beans poriyal; Dinner: ${weekend ? 'Chicken biryani, Gulab jamun' : 'Chapati ×3, Chicken curry'}`,
  }
})

const baseContext = {
  goals: { calories: 1900, protein: 120, carbs: 210, fat: 60 },
  consumed: { calories: 610, protein: 21, carbs: 95, fat: 15, fiber: 6 },
  todayEntries: [{ id: 'e1', name: 'Idli (1)', meal: 'Breakfast', calories: 174, protein: 5, carbs: 36, fat: 1 }],
  currentWeight: '82.4 kg',
  weightUnit: 'kg' as const,
  coach: {
    now: 'Saturday 26 Sep, 19:40',
    profile: { name: 'Karthik', goal: 'lose', age: 27, gender: 'male', heightCm: 174, activityLevel: 'moderate' },
    days,
    weights: [
      { date: days[0].date, kg: 82.6 },
      { date: days[5].date, kg: 82.5 },
      { date: days[11].date, kg: 82.4 },
    ],
    energy: { predictedTdee: 2450, measuredTdee: 2290, confidence: 'medium', trendKgPerWeek: -0.1, daysOfData: 12 },
    plan: { phase: 'cut', calories: 1900, protein: 120, carbs: 210, fat: 60, accepted: true, ageDays: 12 },
    alerts: ['Protein under target on 10 of 12 days'],
    usualFoods: [
      { id: 'in043', name: 'Idli (1)', meal: 'Breakfast', servings: 3 },
      { id: 'in038', name: 'Sambar (1 katori)', meal: 'Lunch', servings: 1 },
      { id: 'in014', name: 'Cooked white rice (1 katori)', meal: 'Lunch', servings: 2 },
      { id: 'in001', name: 'Roti / Chapati (1, no ghee)', meal: 'Dinner', servings: 3 },
      { id: 'in074', name: 'Chicken curry (1 katori)', meal: 'Dinner', servings: 1 },
      { id: 'in106', name: 'Curd / dahi (1 katori)', meal: 'Dinner', servings: 1 },
    ],
    memory: ['Gym at 7am on weekdays'],
  },
}

interface Reply {
  status: number
  text: string
  actions: { tool: string; input: any }[]
  seconds: number
}

process.env.AI_AUTH ??= 'off'
const handlerReady = import('../api/chat').then(m => m.default)

const ask = async (text: string, overrides: Record<string, unknown> = {}): Promise<Reply> => {
  const handler = await handlerReady
  const started = Date.now()
  const res = await handler(
    new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: text }], context: { ...baseContext, ...overrides } }),
    }),
  )
  const json: any = await res.json()
  return {
    status: res.status,
    text: json.text ?? json.error ?? '',
    actions: json.actions ?? [],
    seconds: (Date.now() - started) / 1000,
  }
}

const has = (reply: Reply, tool: string) => reply.actions.some(a => a.tool === tool)
const leaksIds = (reply: Reply) => /\bin\d{3}\b/.test(reply.text)

const SCENARIOS: { name: string; run: () => Promise<{ reply: Reply; pass: boolean; why: string }> }[] = [
  {
    name: 'log',
    run: async () => {
      const reply = await ask('had 2 more idli and a filter coffee, and a pesarattu for lunch with tomato chutney')
      const logged = reply.actions.filter(a => a.tool === 'log_food')
      const catalog = logged.filter(a => a.input.foodId).length
      return { reply, pass: logged.length >= 4 && catalog >= 3, why: `${logged.length} logged, ${catalog} from catalog` }
    },
  },
  {
    name: 'dinner',
    run: async () => {
      const reply = await ask('what should I eat for dinner?')
      return { reply, pass: has(reply, 'offer_meal'), why: has(reply, 'offer_meal') ? 'offered a meal card' : 'no offer_meal' }
    },
  },
  {
    name: 'why',
    run: async () => {
      const reply = await ask('why am I not losing weight?')
      const cites = /2[,.]?[0-9]{3}|over|above/i.test(reply.text)
      const pass = cites && !has(reply, 'propose_targets')
      return { reply, pass, why: `${cites ? 'cites intake' : 'no intake numbers'}${has(reply, 'propose_targets') ? ', proposed targets' : ''}` }
    },
  },
  {
    name: 'remember',
    run: async () => {
      const reply = await ask("btw I don't eat beef and I'm trying to eat more eggs")
      return { reply, pass: has(reply, 'remember'), why: has(reply, 'remember') ? 'saved' : 'not saved' }
    },
  },
  {
    name: 'checkin',
    run: async () => {
      const reply = await ask('Weekly check-in', { mode: 'checkin' })
      const raised = reply.actions.some(a => a.tool === 'propose_targets' && a.input.calories > 1900)
      return { reply, pass: !raised, why: raised ? 'RAISED calories on a stalled cut' : 'no wrong-direction change' }
    },
  },
  {
    name: 'veg',
    run: async () => {
      const reply = await ask('suggest dinner', {
        coach: { ...baseContext.coach, memory: ['Vegetarian; eats eggs'] },
      })
      const meat = reply.actions
        .filter(a => a.tool === 'offer_meal')
        .flatMap(a => a.input.items)
        .filter((item: any) => MEAT.has(BY_ID.get(item.foodId)?.category ?? '') && !/egg|omelette/i.test(item.name))
      return { reply, pass: meat.length === 0 && has(reply, 'offer_meal'), why: meat.length ? `offered ${meat.map((m: any) => m.name).join(', ')}` : has(reply, 'offer_meal') ? 'veg offer' : 'no offer' }
    },
  },
]

const main = async (): Promise<void> => {
  console.log(`Model: ${CHAT_MODEL}`)
  let passed = 0
  let totalSeconds = 0
  for (const scenario of SCENARIOS) {
    const { reply, pass, why } = await scenario.run()
    const ok = pass && reply.status === 200 && !leaksIds(reply)
    if (ok) passed += 1
    totalSeconds += reply.seconds
    console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${scenario.name} (${reply.seconds.toFixed(1)}s, ${reply.status}) ${why}${leaksIds(reply) ? ', LEAKS IDS' : ''}`)
    console.log(reply.text.split('\n').map(line => `    ${line}`).join('\n'))
    for (const action of reply.actions) {
      const detail =
        action.tool === 'offer_meal'
          ? action.input.items.map((i: any) => `${i.name} ×${i.servings}`).join(' + ')
          : JSON.stringify(action.input).slice(0, 140)
      console.log(`    -> ${action.tool}: ${detail}`)
    }
  }
  console.log(`\nSUMMARY ${CHAT_MODEL}: ${passed}/${SCENARIOS.length} passed, ${(totalSeconds / SCENARIOS.length).toFixed(1)}s average`)
}

void main()
