# Supabase Types Regeneration (CLI)

Purpose: keep `src/integrations/supabase/types.ts` aligned with the live Supabase project.

## Prereqs
- Supabase access token with project read access (set `SUPABASE_ACCESS_TOKEN` or run `npx supabase@latest login --token <token>` once).
- Set `SUPABASE_PROJECT_REF` to the target project ref (e.g. `abcd1234`).
- Node + npm (CLI is invoked via `npx supabase@latest`; no global install needed).

## Commands
- Regenerate types:
  ```sh
  SUPABASE_PROJECT_REF=<your_ref> npm run supabase:types
  ```
- Drift check (fails if the working tree changes):
  ```sh
  SUPABASE_PROJECT_REF=<your_ref> npm run check:supabase-types
  ```
  This runs `npx supabase@latest gen types typescript --project-id $SUPABASE_PROJECT_REF --schema public` and exits non-zero if `src/integrations/supabase/types.ts` was modified.

## GitHub Actions
- `.github/workflows/supabase-types.yml` runs weekly + on manual trigger.
- Add secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`.
- Scheduled runs fail on drift; manual dispatch continues, runs lint/build, and commits Supabase artifacts.

## Post Steps
- Run `npm run lint && npm run build && npm run test`
- Commit updated Supabase files (`src/integrations/supabase/types.ts`, `scripts/supabase/schema.sql`, `supabase/migrations/*`) if they changed.
