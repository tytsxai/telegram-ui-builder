# Supabase Backend Readiness Checklist

Target: keep app and Supabase in sync, with strict RLS and typed client coverage.

## Schema & Migrations
- [ ] Confirm `scripts/supabase/schema.sql` and `supabase/migrations/*` applied to target project (tables: `screens`, `user_pins`, `screen_layouts`).
- [ ] Verify RLS enabled on all three tables; ensure policies exist for select/insert/update/delete (owner-only except public read on `screens.is_public = true`).
- [ ] Enable `pgcrypto` extension if `gen_random_uuid()` is used for `screens.id`.
- [ ] CI guard: GitHub Actions workflow runs `npm run lint && npm run build` on every push/PR.

## Types & Client
- [ ] Regenerate `src/integrations/supabase/types.ts` from the live project (now includes `screens`, `user_pins`, `screen_layouts`, relationships to `auth.users`).
- [ ] Run `npm run build` to catch drift; fail CI on type errors or unknown tables.
- [ ] Command (requires Supabase CLI + env): `SUPABASE_PROJECT_REF=<ref> npm run supabase:types`
- [ ] Remove any `fromUnsafe` or untyped `.from(<string>)` usages (none remain).

## Environment
- [ ] Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for each environment (dev/stage/prod); avoid sharing anon keys across envs.
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` only to server-side contexts (never shipped to client).

## Data & RLS Validation
- [ ] Smoke test with anon key: create/update/delete screens as the signed-in user; ensure other users cannot access non-public screens.
- [ ] Public share flow: ensure `/share/:token` only returns `is_public = true` rows and ignores tokens of private screens.
- [ ] Cloud persistence: verify `user_pins` and `screen_layouts` read/write succeed under RLS; test offline fallback to local cache.

## Reliability & Observability
- [ ] Add retry/backoff for Supabase 429/network errors (save, pin, layout sync).
- [ ] Log structured errors (operation, table, user_id, status) for failed Supabase calls.
- [ ] Add audit-friendly events for share create/rotate/unshare.

## Testing
- [ ] Unit: `lib/referenceChecker`, `lib/validation`, `useUndoRedo`, import/export transforms.
- [ ] E2E (Playwright): login → create screen → link button → export/import → share page loads.
- [ ] CI: run `npm run lint` and `npm run build` (and tests if present) on every push/PR.
