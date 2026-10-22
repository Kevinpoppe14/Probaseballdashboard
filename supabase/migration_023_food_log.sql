-- The food log on the athlete's phone page (athlete.html, Nutrition tab): what they ate each day, food by food, with
-- the calories, protein, carbohydrate and fat of each, counted down against their nutrition plan's targets.
--   food_logs   one row per athlete per day: the day's entries as a list
--               ([{ id, meal, name, amount, kcal, c, p, f }, ...]), written from the phone (or by a coach in Coach Mode)
-- Signed-in staff can read and write it (as with athlete_logs); the phone reaches it only through the two
-- token-checked functions below, for the link's own athlete.
-- Run once in the SQL Editor. Safe to run more than once.

create table if not exists food_logs (
  athlete_id text not null,
  day date not null,
  entries jsonb not null default '[]'::jsonb,
  source text not null default 'athlete',  -- 'coach' when written in Coach Mode
  updated_at timestamptz not null default now(),
  primary key (athlete_id, day)
);

alter table food_logs enable row level security;

drop policy if exists "authenticated read food_logs" on food_logs;
drop policy if exists "authenticated write food_logs" on food_logs;
drop policy if exists "authenticated update food_logs" on food_logs;
drop policy if exists "authenticated delete food_logs" on food_logs;
create policy "authenticated read food_logs" on food_logs for select using (auth.role() = 'authenticated');
create policy "authenticated write food_logs" on food_logs for insert with check (auth.role() = 'authenticated');
create policy "authenticated update food_logs" on food_logs for update using (auth.role() = 'authenticated');
create policy "authenticated delete food_logs" on food_logs for delete using (auth.role() = 'authenticated');

-- the athlete's food log from p_from on (at most 62 days of it)
create or replace function athlete_portal_food_get(p_token text, p_from date)
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
    select jsonb_agg(jsonb_build_object('day', f.day, 'entries', f.entries) order by f.day)
    from food_logs f
    where f.athlete_id = v_id and f.day >= greatest(coalesce(p_from, current_date - 14), current_date - 62)
  ), '[]'::jsonb);
end $$;

-- one day's entries, replacing what was there (an empty list clears the day). Days within a week either side of
-- today only, at most 80 entries and 24 KB a day, and at most 2000 days per athlete, so a leaked link can't fill the table.
create or replace function athlete_portal_food_save(p_token text, p_day date, p_entries jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return false; end if;
  if p_day is null or p_day < current_date - 7 or p_day > current_date + 7 then return false; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 80 or length(p_entries::text) > 24000 then return false; end if;
  if (select count(*) from food_logs where athlete_id = v_id) >= 2000
     and not exists (select 1 from food_logs where athlete_id = v_id and day = p_day)
  then return false; end if;

  insert into food_logs (athlete_id, day, entries, source, updated_at)
  values (v_id, p_day, p_entries, 'athlete', now())
  on conflict (athlete_id, day)
  do update set entries = excluded.entries, source = 'athlete', updated_at = now();
  return true;
end $$;

revoke all on function athlete_portal_food_get(text, date) from public;
revoke all on function athlete_portal_food_save(text, date, jsonb) from public;
grant execute on function athlete_portal_food_get(text, date) to anon, authenticated;
grant execute on function athlete_portal_food_save(text, date, jsonb) to anon, authenticated;
