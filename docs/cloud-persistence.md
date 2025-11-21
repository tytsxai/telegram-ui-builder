Cloud persistence (pins + diagram layout)
=======================================

What you get
- user_pins: per-user pinned screen ids
- screen_layouts: per-user per-screen node positions (x,y)
- RLS policies: only the owner (auth.uid()) can read/write

How to apply (choose one)
1) Supabase SQL editor
   - Open the Supabase project → SQL editor → paste `scripts/supabase/schema.sql` → Run

2) Supabase CLI migrations (recommended for teams)
   - `supabase migration new cloud_persistence`
   - Paste the contents of `scripts/supabase/schema.sql`
   - `supabase db push`

Environment required
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in your `.env`

Client behavior and safety
- The app attempts to use these tables if present. If the tables are missing or RLS denies access, it falls back to localStorage without breaking the UX.
- Pins: dual-write to cloud + local; Layouts: dual-write to cloud + local; Reads prefer cloud, then local.

Rollback strategy
- The feature is non-destructive. To fully rollback, drop the two tables:
  - `drop table if exists public.screen_layouts;`
  - `drop table if exists public.user_pins;`

Notes
- Table creation requires elevated privileges; use the SQL editor or CLI with a service role. The client (anon key) cannot create tables.
- RLS ensures only the authenticated user can read/write their rows.

