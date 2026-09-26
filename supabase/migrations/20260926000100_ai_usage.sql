-- ============================================================
-- AI usage counters — the per-user rate limit behind the AI endpoints
-- ============================================================
--
-- WHY THIS EXISTS
-- /api/chat, /api/analyze-photo and /api/recommend spend the owner's Nebius key on every
-- call. api/_auth.ts now requires a signed-in user, but a signed-in user with a script can
-- still run up the bill, so each call also bumps a counter here and the handler refuses
-- with a 429 once a per-minute or per-day ceiling is passed. The ceilings themselves live
-- in api/_auth.ts (AI_LIMITS), not here, so changing them is a deploy, not a migration.
--
-- WHY POSTGRES AND NOT MEMORY
-- Edge functions keep nothing between invocations that can be trusted: every region and
-- every recycled isolate starts from zero. The database is the one place every invocation
-- shares, and the project already has it.
--
-- IF THIS MIGRATION IS NOT APPLIED
-- The endpoints keep working. api/_auth.ts treats a missing function (or a slow or failing
-- one) as "the database cannot count" and falls back to a per-instance count kept in memory,
-- held to the same ceilings and logged once a minute per instance, because an unapplied
-- migration must not take the coach down. That fallback is looser than this table (each
-- instance counts on its own), so apply the migration. Sign-in is enforced either way.
--
-- WHY THERE IS NO PROJECT-WIDE CEILING HERE
-- These counters are per user. A shared "all users, today" counter would bound the total
-- bill, but bump_ai_usage() is callable directly through PostgREST by any signed-in user,
-- and every call counts. So a shared counter would let one account burn the whole project's
-- allowance with a loop against /rest/v1/rpc/bump_ai_usage, without spending a cent at
-- Nebius, and turn the coach off for everyone. Doing it safely needs the per-user ceilings
-- enforced in here, before the shared counter moves. Until then the total is bounded where
-- it is cheapest to bound: sign-up (email confirmation, captcha) and a spend cap at Nebius.

-- 1. One row per user, per endpoint, per window.
--    `span` says which window the row counts ('minute' or 'day'); `bucket_start` is the
--    start of that window in UTC. A user's traffic therefore lands on two rows per
--    endpoint at any moment: the current minute's and the current day's.
--    (`window` would have been the natural name, but it is a reserved word in Postgres.)
CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     TEXT        NOT NULL,
  span         TEXT        NOT NULL CHECK (span IN ('minute', 'day')),
  bucket_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, span, bucket_start)
);

-- The cleanup below deletes by age across every user; without this it would scan the table.
CREATE INDEX IF NOT EXISTS ai_usage_bucket_start_idx ON public.ai_usage (bucket_start);

-- 2. Row Level Security. Users may READ their own counters (useful for a future
--    "N messages left today"), and nothing else. There is deliberately no INSERT, UPDATE or
--    DELETE policy and no write grant: a user who could write here could zero their own
--    counter and the limit would be decoration. Every write goes through
--    bump_ai_usage() below, which runs as the table owner.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own AI usage" ON public.ai_usage;
CREATE POLICY "Users read own AI usage"
  ON public.ai_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Supabase's default privileges can hand new tables to anon and authenticated wholesale.
-- Take that back explicitly, then give back only what the policy above is for.
REVOKE ALL ON public.ai_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_usage TO authenticated;

-- 3. The only way in: count one call for the CALLER and return both running totals.
--
--    - The user comes from auth.uid(), i.e. from the JWT PostgREST already verified. There
--      is no user parameter, so nobody can bump (or be blamed for) someone else's usage.
--    - Both counters move in the same transaction, in the same order every time (minute,
--      then day), so concurrent calls from one user cannot deadlock each other and cannot
--      see one counter moved without the other.
--    - INSERT ... ON CONFLICT DO UPDATE is the atomic increment: two simultaneous calls
--      serialise on the row lock and get consecutive counts, never the same one.
--    - Every call counts, including the ones the handler then refuses. That is what makes
--      the ceiling hold against a client retrying in a tight loop.
--    - The endpoint list is fixed. The function is callable directly through PostgREST, and
--      a free-text endpoint would let a user mint unlimited rows under made-up names.
--      Adding an AI endpoint therefore means adding its name here too.
--    - SECURITY DEFINER with an empty search_path, and every object schema-qualified, so a
--      caller cannot shadow `ai_usage` or `auth.uid` with objects of their own.
CREATE OR REPLACE FUNCTION public.bump_ai_usage(p_endpoint TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user   UUID        := auth.uid();
  v_now    TIMESTAMPTZ := now();
  v_minute INTEGER;
  v_day    INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'bump_ai_usage requires a signed-in user' USING ERRCODE = '42501';
  END IF;

  IF p_endpoint IS NULL OR p_endpoint NOT IN ('chat', 'analyze-photo', 'recommend') THEN
    RAISE EXCEPTION 'unknown AI endpoint: %', p_endpoint USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_usage AS u (user_id, endpoint, span, bucket_start, count)
  VALUES (v_user, p_endpoint, 'minute', date_trunc('minute', v_now), 1)
  ON CONFLICT (user_id, endpoint, span, bucket_start)
  DO UPDATE SET count = u.count + 1
  RETURNING u.count INTO v_minute;

  -- The day is the UTC day (05:30 IST), named explicitly so the session's TimeZone setting
  -- cannot move the boundary. api/_auth.ts computes Retry-After against the same midnight.
  INSERT INTO public.ai_usage AS u (user_id, endpoint, span, bucket_start, count)
  VALUES (v_user, p_endpoint, 'day', date_trunc('day', v_now, 'UTC'), 1)
  ON CONFLICT (user_id, endpoint, span, bucket_start)
  DO UPDATE SET count = u.count + 1
  RETURNING u.count INTO v_day;

  /*
    Housekeeping, on roughly one call in a hundred. Nothing reads a window once it has
    closed, and minute rows accumulate fastest (one per active minute), so without this the
    table grows for as long as anyone uses the coach. Two days keeps yesterday's totals
    around for a look in the SQL editor. The age index makes this a short range delete;
    the same statement can be run by hand at any time:

      DELETE FROM public.ai_usage WHERE bucket_start < now() - interval '2 days';
  */
  IF random() < 0.01 THEN
    DELETE FROM public.ai_usage WHERE bucket_start < v_now - INTERVAL '2 days';
  END IF;

  RETURN jsonb_build_object('minute', v_minute, 'day', v_day);
END;
$$;

-- New functions are executable by PUBLIC, and Supabase's default privileges also grant
-- anon directly, so revoking from PUBLIC alone would leave anon holding it.
REVOKE ALL ON FUNCTION public.bump_ai_usage(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bump_ai_usage(TEXT) TO authenticated;
