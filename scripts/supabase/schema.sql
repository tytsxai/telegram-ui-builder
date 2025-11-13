-- Supabase schema for cloud persistence (safe, owner-scoped)
-- 1) Pins table: per-user list of pinned screen ids
create table if not exists public.user_pins (
  user_id uuid primary key,
  pinned_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.user_pins enable row level security;

-- RLS: owner can read/write
create policy if not exists user_pins_select on public.user_pins
  for select using (auth.uid() = user_id);

create policy if not exists user_pins_upsert on public.user_pins
  for insert with check (auth.uid() = user_id);

create policy if not exists user_pins_update on public.user_pins
  for update using (auth.uid() = user_id);

-- 2) Screen layouts: per-user, per-screen node positions
create table if not exists public.screen_layouts (
  user_id uuid not null,
  screen_id text not null,
  x integer not null,
  y integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, screen_id)
);

alter table public.screen_layouts enable row level security;

-- RLS: owner can read/write
create policy if not exists screen_layouts_select on public.screen_layouts
  for select using (auth.uid() = user_id);

create policy if not exists screen_layouts_upsert on public.screen_layouts
  for insert with check (auth.uid() = user_id);

create policy if not exists screen_layouts_update on public.screen_layouts
  for update using (auth.uid() = user_id);

-- Index to speed up user queries
create index if not exists idx_screen_layouts_user on public.screen_layouts(user_id);

