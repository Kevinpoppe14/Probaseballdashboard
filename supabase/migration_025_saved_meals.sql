-- My meals on the athlete's phone page (athlete.html, Nutrition tab): meals an athlete builds or changes in the meal
-- editor and saves under a name, to log or plan again later.
--   saved_meals   one row per saved meal: { name, meal (the meal it was saved from), items } where items are the
--                 meal editor's foods (a food from the plan's lists and its amount, a food from a label and its amount,
--                 or a logged entry as it was)
-- Each athlete's own; signed-in staff can read and write them (Coach Mode), and the phone reaches them only through
-- the two token-checked functions below, for the link's own athlete.
-- Run once in the SQL Editor. Safe to run more than once.

create table if not exists saved_meals (
  id text primary key,
  athlete_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists saved_meals_athlete on saved_meals (athlete_id);

alter table saved_meals enable row level security;

drop policy if exists "authenticated read saved_meals" on saved_meals;
drop policy if exists "authenticated write saved_meals" on saved_meals;
drop policy if exists "authenticated update saved_meals" on saved_meals;
drop policy if exists "authenticated delete saved_meals" on saved_meals;
create policy "authenticated read saved_meals" on saved_meals for select using (auth.role() = 'authenticated');
create policy "authenticated write saved_meals" on saved_meals for insert with check (auth.role() = 'authenticated');
create policy "authenticated update saved_meals" on saved_meals for update using (auth.role() = 'authenticated');
create policy "authenticated delete saved_meals" on saved_meals for delete using (auth.role() = 'authenticated');

-- the athlete's saved meals, newest first
create or replace function athlete_portal_saved_meals(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'data', m.data) order by m.updated_at desc)
    from saved_meals m where m.athlete_id = v_id
  ), '[]'::jsonb);
end $$;

-- save a meal (p_data null deletes it). A name up to 60 characters, at most 40 foods and 16 KB a meal, and at most
-- 200 meals per athlete, so a leaked link can't fill the table. A meal can only be changed by the athlete who saved it.
create or replace function athlete_portal_saved_meal_save(p_token text, p_id text, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_owner text;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return false; end if;
  if p_id is null or length(p_id) < 6 or length(p_id) > 60 then return false; end if;
  select athlete_id into v_owner from saved_meals where id = p_id;
  if v_owner is not null and v_owner <> v_id then return false; end if;
  if p_data is null then
    delete from saved_meals where id = p_id and athlete_id = v_id;
    return true;
  end if;
  if jsonb_typeof(p_data) <> 'object' or coalesce(trim(p_data->>'name'), '') = '' or length(p_data->>'name') > 60
     or jsonb_typeof(p_data->'items') <> 'array' or jsonb_array_length(p_data->'items') > 40 or length(p_data::text) > 16000 then return false; end if;
  if v_owner is null and (select count(*) from saved_meals where athlete_id = v_id) >= 200 then return false; end if;
  insert into saved_meals (id, athlete_id, data, updated_at) values (p_id, v_id, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

revoke all on function athlete_portal_saved_meals(text) from public;
revoke all on function athlete_portal_saved_meal_save(text, text, jsonb) from public;
grant execute on function athlete_portal_saved_meals(text) to anon, authenticated;
grant execute on function athlete_portal_saved_meal_save(text, text, jsonb) to anon, authenticated;
