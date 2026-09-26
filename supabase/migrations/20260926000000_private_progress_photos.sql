-- Progress photos are body photos, and they sat in a PUBLIC bucket that anyone could list.
--
-- Two separate holes, closed by the two parts of this file:
--
-- * Listing (Part 1). "Photos are publicly readable" has no TO clause, so it applies to
--   every role, anon included, and the anon key ships in the client bundle. With it,
--   anyone can call the Storage list API on 'progress-photos' and get every user's folder
--   and every file name, then fetch each photo (or sign it, which also passes that
--   policy). That is an enumeration of everyone's photos, not a matter of guessing ids.
-- * The public route (Part 2). A public bucket serves every object at
--   /storage/v1/object/public/... with no auth check at all; RLS is never consulted on
--   that route. The URL the app stored was a permanent, unauthenticated link to a body
--   photo, copied into the synced JSON blob and wherever that blob went.
--
-- The app now stores a path reference instead of a URL and shows photos through
-- short-lived signed URLs, which Storage mints only for a caller the SELECT policy below
-- lets read the object, i.e. its owner (src/lib/storage.ts). It still recognises the old
-- public URLs existing accounts hold, so no data rewrite is needed.
--
-- ROLLOUT. The parts are split because they break different things.
--   Part 1 breaks no client, old or new. While the bucket is still public the public route
--   ignores RLS, so old bundles keep showing photos, and the owner-only policy is all that
--   upload, delete and signing need. Run it NOW, ahead of any deploy.
--   Part 2 breaks photos for every client still running the old bundle, which puts the
--   stored public URL straight into an <img>. Run it once the new web build has been live a
--   day: that moves long-open tabs, and PWAs launched during the day, onto it. No wait covers
--   every installed PWA, though. The service worker serves its precached bundle on the first
--   launch after a deploy and nothing reloads the page onto the new one (no
--   virtual:pwa-register prompt), so a PWA first opened after Part 2 shows broken photos for
--   that one session and is fine from the next launch. Separately, an old bundle shows a
--   photo taken on the new build (a storage: reference) as broken, before or after Part 2,
--   until it reloads. Display only; no data is lost either way.
-- Applying the whole file at once (supabase db push, or pasting all of it) is also safe; it
-- only skips that grace period. Every statement can be re-run.

-- ── Part 1: close the listing hole. Safe to run immediately. ───────────────────────────

-- Remove read-for-everyone.
DROP POLICY IF EXISTS "Photos are publicly readable" ON storage.objects;

-- Owners read their own folder, by the same first-path-segment rule the existing upload
-- and delete policies use (path convention: {userId}/{photoId}.jpg). This is also what
-- lets the owner's upload and delete keep working: Storage returns the affected row from
-- both, and Postgres only returns rows the caller may SELECT.
DROP POLICY IF EXISTS "Users read own photos" ON storage.objects;
CREATE POLICY "Users read own photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

-- ── Part 2: make the bucket private. Once the new web build has been live a day. ────────

-- The upsert also covers a project where the bucket was never created, so it cannot come
-- into existence public later by some other script.
INSERT INTO storage.buckets (id, name, public)
VALUES ('progress-photos', 'progress-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Cached copies outlive this statement. It flips a flag on the bucket and touches no
-- object, so nothing invalidates what CDN edges and browsers already hold. Every object
-- was uploaded with storage-js's default Cache-Control (max-age=3600), and the old app
-- loaded each one through its public URL, so an old URL can keep loading for up to an
-- hour after this runs. On the Smart CDN (Pro plan and up), which keeps an asset until it
-- changes, possibly longer. If an old URL still loads well after an hour, rewrite the
-- objects in place (same key, so references and legacy URLs still resolve); a changed
-- object is invalidated at the edge.

-- ── Verify (run after each part; not part of the migration) ────────────────────────────
-- Dropping one policy by name cannot see a permissive SELECT or ALL policy added some
-- other way (a dashboard template, a hand-written one). Every row this returns must be
-- "Users read own photos" or be limited to some other bucket_id; anything else still lets
-- other people read or list the photos, bucket flag or not:
--
--   select policyname, permissive, roles, cmd, qual
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL');
--
-- And after Part 2 this must say false:
--
--   select public from storage.buckets where id = 'progress-photos';
