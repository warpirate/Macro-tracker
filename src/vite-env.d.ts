/// <reference types="vite/client" />

/**
 * Types for the build-time variables Vite inlines.
 *
 * This file was missing, so `import.meta.env` had no type at all and every read of it had
 * to be written `(import.meta as any).env?.SOMETHING`. That cast is not free: it also
 * silences the error on platforms where `import.meta` does not exist, which is how
 * `src/utils/usdaApi.ts` came to read `VITE_USDA_API_KEY` in code that the mobile app
 * vendors and runs under Metro. There the whole expression was undefined, the key silently
 * fell back to the shared DEMO_KEY, and food search failed under load for a year.
 *
 * Declaring the shape means a typo in a variable name is a compile error, and it means
 * nobody has to reach for `as any` to read one.
 *
 * Only `VITE_`-prefixed names are exposed to the client bundle, and everything here ships
 * inside it. Never add a secret.
 */
interface ImportMetaEnv {
  /** Supabase project URL. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon/publishable key. Protected by row level security, not by secrecy. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * USDA FoodData Central key. Optional: absent falls back to the shared DEMO_KEY, which is
   * capped at 30 requests a minute and 1000 a day across every anonymous caller.
   */
  readonly VITE_USDA_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
