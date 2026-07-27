# Deploying MacroFit

Two pieces have to exist before anything is reachable from the internet:

1. a **hosted Supabase project** — auth and cloud sync; without it nobody can sign in
2. a **Vercel deployment** — serves the site *and* the `/api/*` AI endpoints

The mobile app then points at both. Order matters: Supabase first, Vercel second, mobile
last, because each step needs the URL from the one before it.

---

## 1. Supabase (once, ~3 minutes)

1. Create a project at [https://supabase.com/dashboard](https://supabase.com/dashboard). Any region; the free tier is fine.
2. Open **SQL Editor** and run the whole of [`supabase-schema.sql`](supabase-schema.sql).
   It creates `user_data`, enables RLS, adds the policy, **grants table privileges to
   `authenticated`**, and creates the `progress-photos` storage bucket with its policies.

   > The grant is not optional. RLS decides *which rows* a role may touch, but Postgres
   > checks table privileges first — without it every request fails with
   > `42501 permission denied for table user_data` and the app just reports "sync error".
   >
3. From **Project Settings → API**, copy:

   - Project URL → `VITE_SUPABASE_URL`
   - `anon` `public` key → `VITE_SUPABASE_ANON_KEY`

   The `anon` key is safe in a client bundle; it is protected by RLS. The `service_role`
   key is **not** — it bypasses RLS entirely and must never appear in the frontend, the
   mobile app, or this repository.

## 2. Vercel

Easiest path is the GitHub integration — no CLI, no tokens:

1. [https://vercel.com/new](https://vercel.com/new) → import this repository.
2. Framework preset: **Vite**. Build command `npm run build`, output `dist`. Vercel
   detects both; `vercel.json` already handles SPA routing and the `/api` functions.
3. Add environment variables (all environments):

   | Variable                   | Value                                      | Exposed to browser          |
   | -------------------------- | ------------------------------------------ | --------------------------- |
   | `VITE_SUPABASE_URL`      | from step 1                                | yes                         |
   | `VITE_SUPABASE_ANON_KEY` | from step 1                                | yes                         |
   | `VITE_USDA_API_KEY`      | your USDA key, or`DEMO_KEY`              | yes                         |
   | `NEBIUS_API_KEY`         | Nebius Token Factory key                   | **no — server only** |
   | `NEBIUS_BASE_URL`        | `https://api.tokenfactory.nebius.com/v1` | no                          |
   | `NEBIUS_CHAT_MODEL`      | `Qwen/Qwen3-235B-A22B-Instruct-2507`     | no                          |
   | `NEBIUS_VISION_MODEL`    | `Qwen/Qwen2.5-VL-72B-Instruct`           | no                          |

   Anything prefixed `VITE_` is **inlined into the JavaScript bundle** and is public.
   `NEBIUS_API_KEY` has no prefix precisely so it stays server-side, readable only by the
   edge functions in `api/`.
4. Deploy, then add the deployment URL to Supabase under
   **Authentication → URL Configuration → Site URL / Redirect URLs**, or email
   confirmation and magic links will bounce back to `localhost`.

### CLI alternative

```bash
npx vercel login
npx vercel link
npx vercel env add NEBIUS_API_KEY production   # repeat per variable
npx vercel --prod
```

## 3. Verify the deployment

```bash
# should return 400 (a request with no bodyweight is rejected), NOT 404 or 500
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<your-app>/api/recommend \
  -H "Content-Type: application/json" -d '{}'

# should return 405 — the endpoint exists and refuses GET
curl -s -o /dev/null -w "%{http_code}\n" https://<your-app>/api/chat
```

`404` means the functions were not deployed; `500` usually means `NEBIUS_API_KEY` is
missing. Then sign up in the browser and confirm the sync indicator reaches "Saved".

## 4. Mobile app

Update `mobile/.env` to point at the deployed backend instead of a LAN address:

```
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
EXPO_PUBLIC_API_URL=https://<your-app>.vercel.app
EXPO_PUBLIC_USDA_API_KEY=DEMO_KEY
```

`EXPO_PUBLIC_*` values are baked in **at build time**, so the APK must be rebuilt after
changing them:

```bash
cd mobile
npx expo prebuild --platform android
node scripts/apply-signing.mjs
cd android && ./gradlew assembleRelease
```

The signed APK lands at `mobile/android/app/build/outputs/apk/release/app-release.apk`.

> Keep `mobile/credentials/` safe and backed up. Android refuses to install an update
> signed with a different key, so losing that keystore means every existing install has to
> be uninstalled before it can be updated.
