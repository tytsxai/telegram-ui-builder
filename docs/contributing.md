# Contributing

Thanks for helping improve Telegram UI Components! This guide keeps changes consistent and CI-friendly.

## Workflow
- Package manager: **npm** (lockfile committed). Use `npm ci` for clean installs.
- Branch from `main`; open PRs with a clear summary + before/after if UI changes.
- Required checks before pushing:
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - If you touched Supabase schema/types: `SUPABASE_PROJECT_REF=<ref> npm run check:supabase-types`

## Coding guidelines
- TypeScript first; avoid `any` unless you document why.
- Keep components controlled where possible; prefer small, composable hooks over monoliths.
- Accessibility: ensure focus order, keyboard access, and `aria-*` on new UI.
- Avoid feature flags for small tweaks; delete dead code instead of gating it.

## Supabase changes
- Schema lives in `supabase/migrations` and `scripts/supabase/schema.sql`.
- Regenerate types after schema changes: `SUPABASE_PROJECT_REF=<ref> npm run supabase:types`.
- Add/adjust RLS in migrations and verify with `npm run smoke:rls` (needs service role keys).

## Tests
- Unit/integration: `npm test` (Vitest, jsdom).
- E2E: `npm run test:e2e` (requires running dev server and Supabase env values).
- Add/extend tests for new behaviors; keep noisy logs stubbed in tests.

## PR checklist
- [ ] Lint/test/build pass locally.
- [ ] Supabase types checked (if schema touched).
- [ ] UI changes include a brief description or screenshot/GIF.
- [ ] Accessibility considered (focus, keyboard, labels).

