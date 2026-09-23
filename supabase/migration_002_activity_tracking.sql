-- Adds "Created by / Last updated by" tracking to every record — a signature line, not a full
-- change history (see supabase/SETUP.md for that tradeoff). Run this once in the SQL Editor on a
-- project that already has schema.sql applied. Safe to run more than once (every statement guards
-- against already existing).

-- 1. A public, client-readable mirror of auth.users — the client can't query auth.users directly,
--    and this is just enough (id + email) to show who did what. Kept in sync automatically any
--    time a coach is added or their auth record changes.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "authenticated read profiles" on profiles;
create policy "authenticated read profiles" on profiles for select using (auth.role() = 'authenticated');

-- Backfill for coaches already added (e.g. test@test.com and anyone else created before this ran).
insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do update set email = excluded.email;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function handle_new_user();

-- 2. created_by / updated_by / created_at on every data table. These are stamped by a trigger
--    (below) using auth.uid() — the signed-in user's id straight from their session, on the server
--    — never sent up by the client, so there's nothing for a coach's browser to spoof.
do $$
declare
  t text;
begin
  foreach t in array array['athletes','force_tests','body_comp','manual_wellness','notes',
                            'player_plans','periodization','period_templates','assessments']
  loop
    execute format('alter table %I add column if not exists created_by uuid references auth.users(id);', t);
    execute format('alter table %I add column if not exists updated_by uuid references auth.users(id);', t);
    execute format('alter table %I add column if not exists created_at timestamptz not null default now();', t);
  end loop;
end $$;

create or replace function stamp_activity()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['athletes','force_tests','body_comp','manual_wellness','notes',
                            'player_plans','periodization','period_templates','assessments']
  loop
    execute format('drop trigger if exists stamp_activity_trigger on %I;', t);
    execute format(
      'create trigger stamp_activity_trigger before insert or update on %I for each row execute function stamp_activity();', t);
  end loop;
end $$;
