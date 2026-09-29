/**
 * Soft mode must keep old and lapsed builds working: a call with no token, or with a token
 * Supabase rejects, is let through (and then fails validation on its empty body, 400) instead
 * of being told to sign in (401).
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… npx tsx --env-file=.env scripts/check-ai-auth-soft.ts
 *
 * The rejected-token case asks a real Supabase whether the token is good, so it needs one that
 * answers. This repo's .env points VITE_SUPABASE_URL at a local Supabase (127.0.0.1); unless
 * that is running, every lookup fails as "unavailable" (503) and the case cannot pass. Export
 * the hosted project's SUPABASE_URL and SUPABASE_ANON_KEY for the run: they take precedence over
 * the VITE_ ones, and --env-file never overrides a variable already set.
 */
process.env.AI_AUTH = 'soft'

const main = async (): Promise<void> => {
  const handler = (await import('../api/chat')).default
  const call = (headers: Record<string, string>) =>
    handler(new Request('http://local/api/chat', { method: 'POST', headers, body: '{}' }))

  const cases: { name: string; headers: Record<string, string> }[] = [
    { name: 'no token', headers: {} },
    { name: 'rejected token', headers: { authorization: 'Bearer not-a-real-session-token' } },
  ]

  let failed = 0
  for (const c of cases) {
    const res = await call(c.headers)
    const ok = res.status === 400
    if (!ok) failed += 1
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.name}: ${res.status}${ok ? '' : ' (expected 400)'}`)
  }
  process.exit(failed ? 1 : 0)
}

void main()
