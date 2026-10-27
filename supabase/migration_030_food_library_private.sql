-- Custom foods an athlete types in stay their own; a coach's go to everyone (the shared food library, migration_024
-- and migration_027). A food in food_library is shared with everyone's food log when any of these is true:
--   - a coach added it (source "coach": the dashboard's Food library, Coach Mode, or a coach's own app link)
--   - it was scanned from a barcode (it's the product's label, so the next athlete who scans it gets it)
--   - a coach shared it from the dashboard's Food library (shared = true)
-- Otherwise (an athlete typed it in) only that athlete sees it in their app; coaches see it on the dashboard and in
-- Coach Mode for that athlete. Foods athletes added before this keep working for them; they just stop showing for
-- everyone else unless a coach shares them.
-- Run once in the SQL Editor (after migration_027). Safe to run more than once.

create or replace function food_library_visible(p_data jsonb, p_athlete text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_data->>'source', '') <> 'athlete'
      or coalesce(p_data->>'barcode', '') <> ''
      or coalesce((p_data->>'shared')::boolean, false)
      or coalesce(p_data->>'athleteId', '') = coalesce(p_athlete, '')
$$;

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
      'barcode', coalesce(f.data->>'barcode', ''),
      'mine', coalesce(f.data->>'athleteId', '') = v_id
    ) order by lower(f.data->>'name'))
    from (select * from food_library where food_library_visible(data, v_id) order by updated_at desc limit 5000) f
  ), '[]'::jsonb);
end $$;

-- add a food from a label (or a barcode scan). The one already there for that barcode, or under the same name, serving
-- and calories among the foods this person can see, is handed back instead. A coach's own link (their record is in the
-- "coaches" roster group) adds it as a coach's food, for everyone.
create or replace function athlete_portal_food_library_add(p_token text, p_food jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_coach boolean;
  v_name text := left(trim(coalesce(p_food->>'name', '')), 60);
  v_unit text := coalesce(p_food->>'sUnit', '');
  v_code text := regexp_replace(coalesce(p_food->>'barcode', ''), '\D', '', 'g');
  v_samt numeric;
  v_kcal numeric; v_p numeric; v_c numeric; v_f numeric;
  v_existing text;
  v_new text;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return null; end if;
  select coalesce(data->>'rosterGroup', '') = 'coaches' into v_coach from athletes where id::text = v_id;
  v_coach := coalesce(v_coach, false);
  if length(v_code) < 6 or length(v_code) > 14 then v_code := ''; end if;
  -- the same product already in the library, by its barcode
  if v_code <> '' then
    select id into v_existing from food_library where data->>'barcode' = v_code limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;
  if v_name = '' or v_unit not in ('serving', 'piece', 'g', 'oz', 'cup', 'fl oz', 'tbsp', 'tsp') then return null; end if;
  begin
    v_samt := (p_food->>'sAmt')::numeric; v_kcal := (p_food->>'kcal')::numeric;
    v_p := coalesce((p_food->>'p')::numeric, 0); v_c := coalesce((p_food->>'c')::numeric, 0); v_f := coalesce((p_food->>'f')::numeric, 0);
  exception when others then return null;
  end;
  if v_samt is null or v_samt <= 0 or v_samt > 5000 or v_kcal is null or v_kcal < 0 or v_kcal > 5000
     or v_p < 0 or v_p > 500 or v_c < 0 or v_c > 500 or v_f < 0 or v_f > 500 then return null; end if;

  select id into v_existing from food_library
  where food_library_visible(data, v_id)
    and lower(data->>'name') = lower(v_name) and data->>'sUnit' = v_unit and (data->>'sAmt')::numeric = v_samt
    and abs((data->>'kcal')::numeric - v_kcal) < 1
  limit 1;
  if v_existing is not null then
    if v_code <> '' then
      update food_library set data = data || jsonb_build_object('barcode', v_code), updated_at = now()
      where id = v_existing and coalesce(data->>'barcode', '') = '';
    end if;
    return v_existing;
  end if;
  if (select count(*) from food_library where data->>'athleteId' = v_id) >= 500 then return null; end if;

  v_new := 'fl-' || md5(v_id || clock_timestamp()::text || random()::text);
  begin
    insert into food_library (id, data) values (v_new, jsonb_build_object(
      'name', v_name, 'sAmt', v_samt, 'sUnit', v_unit, 'kcal', round(v_kcal), 'p', round(v_p, 1), 'c', round(v_c, 1), 'f', round(v_f, 1),
      'source', case when v_coach then 'coach' else 'athlete' end, 'athleteId', v_id,
      'addedBy', coalesce((select data->>'name' from athletes where id::text = v_id), '')
    ) || case when v_code <> '' then jsonb_build_object('barcode', v_code) else '{}'::jsonb end);
  exception when unique_violation then
    select id into v_new from food_library where data->>'barcode' = v_code limit 1;
  end;
  return v_new;
end $$;

revoke all on function athlete_portal_food_library(text) from public;
revoke all on function athlete_portal_food_library_add(text, jsonb) from public;
grant execute on function athlete_portal_food_library(text) to anon, authenticated;
grant execute on function athlete_portal_food_library_add(text, jsonb) to anon, authenticated;
grant execute on function food_library_visible(jsonb, text) to anon, authenticated;
