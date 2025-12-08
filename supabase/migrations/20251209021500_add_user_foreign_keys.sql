-- Ensure user-owned tables enforce auth.users foreign keys
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'user_pins'
  ) and not exists (
    select 1 from pg_constraint where conname = 'user_pins_user_id_fkey'
  ) then
    alter table public.user_pins
      add constraint user_pins_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'screen_layouts'
  ) and not exists (
    select 1 from pg_constraint where conname = 'screen_layouts_user_id_fkey'
  ) then
    alter table public.screen_layouts
      add constraint screen_layouts_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;
