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
- Layouts load from localStorage first (`diagram_positions_<userId|anon>`), then overlay cloud positions for the signed-in user. If `screen_layouts` is missing or denied by RLS, the diagram stays on local/auto layout.
- “保存布局” writes to localStorage and upserts `screen_layouts` (debounced autosave after drag). “重置位置” clears both localStorage and cloud rows, then reverts to Dagre auto layout.
- Pins live only in `user_pins`; toggling pins calls Supabase `upsert`. On failure, the UI reverts the change and toasts; without the table/policy, pins will not persist across reloads.

Rollback strategy
- The feature is non-destructive. To fully rollback, drop the two tables:
  - `drop table if exists public.screen_layouts;`
  - `drop table if exists public.user_pins;`

Notes
- Table creation requires elevated privileges; use the SQL editor or CLI with a service role. The client (anon key) cannot create tables.
- RLS ensures only the authenticated user can read/write their rows.
