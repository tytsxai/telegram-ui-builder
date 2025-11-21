# Supabase Types Regeneration (CLI)

Purpose: keep `src/integrations/supabase/types.ts` aligned with the live Supabase project.

## Prereqs
- Install Supabase CLI: https://supabase.com/docs/guides/cli
- Auth with your project: `supabase login`
- Set env var `SUPABASE_PROJECT_REF` to the target project ref (e.g. `abcd1234`).

## Command
```sh
SUPABASE_PROJECT_REF=<your_ref> npm run supabase:types
```
This runs:
```sh
supabase gen types typescript --project-ref $SUPABASE_PROJECT_REF --schema public > src/integrations/supabase/types.ts
```

## Post Steps
- Run `npm run lint && npm run build`
- Commit updated `src/integrations/supabase/types.ts`
- If schema/RLS changed, update `docs/backend-readiness.md`
