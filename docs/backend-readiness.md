# Supabase Backend Readiness Checklist

Target: keep app and Supabase in sync, with strict RLS and typed client coverage.

## Schema & Migrations
- [ ] Confirm `scripts/supabase/schema.sql` and `supabase/migrations/*` applied to target project (tables: `screens`, `user_pins`, `screen_layouts`).
- [ ] Verify RLS enabled on all three tables; ensure policies exist for select/insert/update/delete (owner-only). Public share reads should go through `get_public_screen_by_token` RPC, not a broad SELECT policy.
- [ ] Ensure `screens_public_no_sensitive` constraint exists to block public screens with wallet/address data.
- [ ] Enable `pgcrypto` extension if `gen_random_uuid()` is used for `screens.id`.
- [ ] CI guard: GitHub Actions workflow runs `npm run lint && npm run build` on every push/PR.
- [ ] Types guard: regenerate types from live project. See `docs/supabase-types-regeneration.md`.

## Types & Client
- [ ] Regenerate `src/integrations/supabase/types.ts` from the live project (now includes `screens`, `user_pins`, `screen_layouts`, relationships to `auth.users`).
- [ ] Run `npm run build` to catch drift; fail CI on type errors or unknown tables.
- [ ] Command (requires Supabase CLI + env): `SUPABASE_PROJECT_REF=<ref> npm run supabase:types`
- [ ] Remove any `fromUnsafe` or untyped `.from(<string>)` usages (none remain).
- [ ] Route schema changes through `lib/dataAccess.ts` first (single gateway for Supabase CRUD + retry) and then `useSupabaseSync`; queue payloads (`pending_ops_v2_<userId>`) rely on the same shapes.

## Environment
- [ ] Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for each environment (dev/stage/prod); avoid sharing anon keys across envs.
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` only to server-side contexts (never shipped to client).
- [ ] Set `VITE_ERROR_REPORTING_URL` (and API key if needed) for production error capture.
- [ ] Inject `VITE_APP_VERSION` or `VITE_COMMIT_SHA` in production builds for release tagging.
- [ ] Enable leaked password protection in Supabase Auth settings for hosted projects.
- [ ] Run `npm run check:env` (or `npm run build:prod`) in release pipelines to catch missing/placeholder/insecure keys.

## Data & RLS Validation
- [ ] Smoke test with anon key: create/update/delete screens as the signed-in user; ensure other users cannot access non-public screens.
- [ ] Public share flow: ensure `/share/:token` reads via `get_public_screen_by_token` (token-based RPC) and ignores tokens for private screens; direct SELECT on `screens` should remain owner-only.
- [ ] Cloud persistence: verify `user_pins` and `screen_layouts` read/write succeed under RLS; test offline fallback to local cache.

## Reliability & Observability
- [ ] Add retry/backoff for Supabase 429/network errors (save, pin, layout sync) — current `dataAccess` uses `supabaseRetry`, keep it single-writer.
- [ ] Log structured errors (operation, table, user_id, status) for failed Supabase calls.
- [ ] Add audit-friendly events for share create/rotate/unshare.
- [ ] Document offline queue contract: `pending_ops_v2_<userId>` in `localStorage`, dedupes updates per screen; version bumps require migration, replay test, and alignment with `SupabaseDataAccess` behavior.

## Testing
- [ ] Unit: `lib/referenceChecker`, `lib/validation`, `useUndoRedo`, import/export transforms.
- [ ] E2E (Playwright): login → create screen → link button → export/import → share page loads.
- [ ] CI: run `npm run lint` and `npm run build` (and tests if present) on every push/PR.
