-- Ensure pgcrypto for UUID generation
create extension if not exists "pgcrypto";

-- User pins table (owner-scoped)
create table if not exists public.user_pins (
  user_id uuid primary key,
  pinned_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.user_pins enable row level security;

create policy if not exists user_pins_select on public.user_pins
  for select using (auth.uid() = user_id);

create policy if not exists user_pins_upsert on public.user_pins
  for insert with check (auth.uid() = user_id);

create policy if not exists user_pins_update on public.user_pins
  for update using (auth.uid() = user_id);

-- Screen layouts table (owner-scoped, composite PK)
create table if not exists public.screen_layouts (
  user_id uuid not null,
  screen_id text not null,
  x integer not null,
  y integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, screen_id)
);

alter table public.screen_layouts enable row level security;

create policy if not exists screen_layouts_select on public.screen_layouts
  for select using (auth.uid() = user_id);

create policy if not exists screen_layouts_upsert on public.screen_layouts
  for insert with check (auth.uid() = user_id);

create policy if not exists screen_layouts_update on public.screen_layouts
  for update using (auth.uid() = user_id);

create index if not exists idx_screen_layouts_user on public.screen_layouts(user_id);
