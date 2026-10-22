-- The shared food library: custom foods entered from a nutrition label by athletes (phone food log) and coaches
-- (Coach Mode, or the Food library on the dashboard's Nutrition tab), kept for good and searchable by everyone in the
-- food log, beside the built-in food database (foods_db.js) and the foods of each athlete's plan.
--   food_library   one row per food: { name, sAmt, sUnit, kcal, p, c, f, source, athleteId, addedBy }
--                  (one serving as its label gives it; source "athlete" or "coach")
-- Signed-in staff can read, correct and delete them; the phone reaches them only through the two token-checked
-- functions below.
-- Run once in the SQL Editor. Safe to run more than once.

create table if not exists food_library (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table food_library enable row level security;

drop policy if exists "authenticated read food_library" on food_library;
drop policy if exists "authenticated write food_library" on food_library;
drop policy if exists "authenticated update food_library" on food_library;
drop policy if exists "authenticated delete food_library" on food_library;
create policy "authenticated read food_library" on food_library for select using (auth.role() = 'authenticated');
create policy "authenticated write food_library" on food_library for insert with check (auth.role() = 'authenticated');
create policy "authenticated update food_library" on food_library for update using (auth.role() = 'authenticated');
create policy "authenticated delete food_library" on food_library for delete using (auth.role() = 'authenticated');

-- every food in the library (name, serving and figures, and whether this athlete added it)
create or replace function athlete_portal_food_library(p_token text)
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
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.data->>'name', 'sAmt', f.data->'sAmt', 'sUnit', f.data->>'sUnit',
      'kcal', f.data->'kcal', 'p', f.data->'p', 'c', f.data->'c', 'f', f.data->'f',
      'mine', coalesce(f.data->>'athleteId', '') = v_id
    ) order by lower(f.data->>'name'))
    from (select * from food_library order by updated_at desc limit 5000) f
  ), '[]'::jsonb);
end $$;

-- add a food from a label; one already in the library under the same name, serving and calories is reused.
-- Names up to 60 characters, sensible figures, and at most 500 foods per athlete, so a leaked link can't fill the table.
create or replace function athlete_portal_food_library_add(p_token text, p_food jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_name text := left(trim(coalesce(p_food->>'name', '')), 60);
  v_unit text := coalesce(p_food->>'sUnit', '');
  v_samt numeric;
  v_kcal numeric; v_p numeric; v_c numeric; v_f numeric;
  v_existing text;
  v_new text;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return null; end if;
  if v_name = '' or v_unit not in ('serving', 'piece', 'g', 'oz', 'cup', 'fl oz', 'tbsp', 'tsp') then return null; end if;
  begin
    v_samt := (p_food->>'sAmt')::numeric; v_kcal := (p_food->>'kcal')::numeric;
    v_p := coalesce((p_food->>'p')::numeric, 0); v_c := coalesce((p_food->>'c')::numeric, 0); v_f := coalesce((p_food->>'f')::numeric, 0);
  exception when others then return null;
  end;
  if v_samt is null or v_samt <= 0 or v_samt > 5000 or v_kcal is null or v_kcal < 0 or v_kcal > 5000
     or v_p < 0 or v_p > 500 or v_c < 0 or v_c > 500 or v_f < 0 or v_f > 500 then return null; end if;

  select id into v_existing from food_library
  where lower(data->>'name') = lower(v_name) and data->>'sUnit' = v_unit and (data->>'sAmt')::numeric = v_samt
    and abs((data->>'kcal')::numeric - v_kcal) < 1
  limit 1;
  if v_existing is not null then return v_existing; end if;
  if (select count(*) from food_library where data->>'athleteId' = v_id) >= 500 then return null; end if;

  v_new := 'fl-' || md5(v_id || clock_timestamp()::text || random()::text);
  insert into food_library (id, data) values (v_new, jsonb_build_object(
    'name', v_name, 'sAmt', v_samt, 'sUnit', v_unit, 'kcal', round(v_kcal), 'p', round(v_p, 1), 'c', round(v_c, 1), 'f', round(v_f, 1),
    'source', 'athlete', 'athleteId', v_id,
    'addedBy', coalesce((select data->>'name' from athletes where id = v_id), '')
  ));
  return v_new;
end $$;

revoke all on function athlete_portal_food_library(text) from public;
revoke all on function athlete_portal_food_library_add(text, jsonb) from public;
grant execute on function athlete_portal_food_library(text) to anon, authenticated;
grant execute on function athlete_portal_food_library_add(text, jsonb) to anon, authenticated;
