-- Supabase schema for Telegram UI Builder (screens, pins, layouts)
create extension if not exists "pgcrypto";

-- 1) Screens table: bot message screens with share tokens
create table if not exists public.screens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  message_content text not null,
  keyboard jsonb not null,
  is_public boolean default false,
  share_token text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.screens enable row level security;

create policy if not exists "Users can view own screens" on public.screens
  for select using (auth.uid() = user_id);

create policy if not exists "Anyone can view public screens" on public.screens
  for select using (is_public = true);

create policy if not exists "Users can insert own screens" on public.screens
  for insert with check (auth.uid() = user_id);

create policy if not exists "Users can update own screens" on public.screens
  for update using (auth.uid() = user_id);

create policy if not exists "Users can delete own screens" on public.screens
  for delete using (auth.uid() = user_id);

create index if not exists idx_screens_share_token on public.screens(share_token) where share_token is not null;
create index if not exists idx_screens_user_id on public.screens(user_id);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_screens_updated_at on public.screens;
create trigger update_screens_updated_at
before update on public.screens
for each row
execute function public.update_updated_at_column();

-- 2) Pins table: per-user list of pinned screen ids
create table if not exists public.user_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
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

-- 3) Screen layouts: per-user, per-screen node positions
create table if not exists public.screen_layouts (
  user_id uuid not null references auth.users(id) on delete cascade,
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
