# Supabase Setup (dev/stage)

This project expects a Supabase project (or local Supabase CLI instance) with the schema in `supabase/migrations` / `scripts/supabase/schema.sql`.

## Quick start (local CLI)
```bash
supabase start              # launches local stack
supabase db push            # applies migrations
cp .env.example .env        # set VITE_SUPABASE_URL to the local API URL, fill publishable key
npm run dev
```

## Existing hosted project
1) Set env vars in `.env`:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Optional for scripts: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`
2) Apply schema: run `supabase db push` (with the repo migrations) or execute `scripts/supabase/schema.sql` in the SQL editor.
3) Verify RLS policies on `screens`, `user_pins`, `screen_layouts` (owner-only, except public read on published screens).
4) Regenerate types against the project:
```bash
SUPABASE_PROJECT_REF=<ref> npm run supabase:types
```

## Smoke checks
- Run `npm run smoke:rls` (requires service role + anon key) to ensure policies allow expected ops.
- Run `npm run build` to catch drift in generated types and data access.

## Troubleshooting
- If `npm run supabase:types` fails: ensure `SUPABASE_PROJECT_REF` and auth token (`SUPABASE_ACCESS_TOKEN` or `supabase login`) are set.
- If local CLI ports differ, update `VITE_SUPABASE_URL` accordingly.

