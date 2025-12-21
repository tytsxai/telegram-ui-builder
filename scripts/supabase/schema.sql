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

-- Public share reads are handled via RPC; drop any legacy public policy.
drop policy if exists "Anyone can view public screens" on public.screens;

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

create or replace function public.screen_contains_sensitive_data(message_content text, keyboard jsonb)
returns boolean
language sql
immutable
as $$
  select
    coalesce(message_content, '') ~* pattern
    or coalesce(keyboard::text, '') ~* pattern
  from (
    select E'(?:\\b0x[a-fA-F0-9]{40}\\b|\\bT[1-9A-HJ-NP-Za-km-z]{33}\\b|\\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}\\b)' as pattern
  ) as patterns;
$$;

update public.screens
set is_public = false,
    share_token = null
where is_public = true
  and public.screen_contains_sensitive_data(message_content, keyboard);

alter table public.screens
  drop constraint if exists screens_public_no_sensitive;

alter table public.screens
  add constraint screens_public_no_sensitive
  check (is_public = false or not public.screen_contains_sensitive_data(message_content, keyboard));

-- Public share access RPC (token-based, no broad SELECT)
drop function if exists public.get_public_screen_by_token(text);

create function public.get_public_screen_by_token(token text)
returns table (
  id uuid,
  name text,
  message_content text,
  keyboard jsonb,
  is_public boolean,
  share_token text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    s.message_content,
    s.keyboard,
    s.is_public,
    s.share_token,
    s.created_at,
    s.updated_at
  from public.screens s
  where s.is_public = true
    and s.share_token = token
  limit 1;
$$;

revoke all on function public.get_public_screen_by_token(text) from public;
grant execute on function public.get_public_screen_by_token(text) to anon, authenticated;

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
