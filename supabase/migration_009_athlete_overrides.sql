-- Lets an athlete change an exercise, or its sets and reps, from the phone page (athlete.html).
--   athlete_overrides  one row per changed exercise per athlete: { name, groups: [{ sets, reps, intensity }], from }.
--                      The program itself is never edited, so a program shared by several athletes is untouched
--                      and a coach can undo a change by removing the row.
-- athlete_portal_get now also returns the athlete's changes (and the videos for any exercise they switched to).
-- Two new functions: athlete_portal_override saves or removes changes, athlete_portal_exercises searches the
-- exercise library by name so a typed exercise can match one with a video.
-- Run once in the SQL Editor after migration_008. Safe to run more than once.

create table if not exists athlete_overrides (
  athlete_id text not null,
  program_id text not null,
  exercise_id text not null,
  data jsonb not null,
  source text not null default 'athlete',
  updated_at timestamptz not null default now(),
  primary key (athlete_id, program_id, exercise_id)
);

alter table athlete_overrides enable row level security;

drop policy if exists "authenticated read athlete_overrides" on athlete_overrides;
drop policy if exists "authenticated write athlete_overrides" on athlete_overrides;
drop policy if exists "authenticated update athlete_overrides" on athlete_overrides;
drop policy if exists "authenticated delete athlete_overrides" on athlete_overrides;
create policy "authenticated read athlete_overrides" on athlete_overrides for select using (auth.role() = 'authenticated');
create policy "authenticated write athlete_overrides" on athlete_overrides for insert with check (auth.role() = 'authenticated');
create policy "authenticated update athlete_overrides" on athlete_overrides for update using (auth.role() = 'authenticated');
create policy "authenticated delete athlete_overrides" on athlete_overrides for delete using (auth.role() = 'authenticated');

create or replace function athlete_portal_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_name text;
  v_plan jsonb;
  v_program_ids text[];
  v_names text[];
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select athlete_id, name into v_id, v_name from athlete_links where token = p_token;
  if v_id is null then return null; end if;

  select data into v_plan from periodization where athlete_id = v_id;

  select coalesce(array_agg(distinct b->>'programId'), '{}') into v_program_ids
  from jsonb_array_elements(case when jsonb_typeof(v_plan->'blocks') = 'array' then v_plan->'blocks' else '[]'::jsonb end) b
  where coalesce(b->>'programId', '') <> '';

  -- exercise names in the athlete's programs, plus any they have switched to
  select coalesce(array_agg(distinct x), '{}') into v_names from (
    select lower(trim(n #>> '{}')) as x
    from programs p, jsonb_path_query(p.data, '$.weeks[*].sessions[*].exercises[*].name') n
    where p.id = any(v_program_ids)
    union
    select lower(trim(o.data->>'name')) from athlete_overrides o where o.athlete_id = v_id
  ) names where x is not null and x <> '';

  return jsonb_build_object(
    'athlete', jsonb_build_object(
      'name', v_name,
      'offseasonFacility', (select data->>'offseasonFacility' from athletes where id = v_id)),
    'plan', case when v_plan is null then null else jsonb_build_object(
      'startDate', v_plan->'startDate',
      'weeks', v_plan->'weeks',
      'goals', v_plan->'goals',
      'actionPlan', v_plan->'actionPlan',
      'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', l->'id', 'name', l->'name', 'color', l->'color')), '[]'::jsonb)
                from jsonb_array_elements(case when jsonb_typeof(v_plan->'lanes') = 'array' then v_plan->'lanes' else '[]'::jsonb end) l),
      'blocks', (select coalesce(jsonb_agg(jsonb_build_object('id', b->'id', 'lane', b->'lane', 'start', b->'start', 'len', b->'len', 'label', b->'label', 'color', b->'color', 'programId', b->'programId')), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(v_plan->'blocks') = 'array' then v_plan->'blocks' else '[]'::jsonb end) b),
      'programLog', coalesce(v_plan->'programLog', '{}'::jsonb)
    ) end,
    'programs', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.data->'name', 'weeks', p.data->'weeks')), '[]'::jsonb)
                 from programs p where p.id = any(v_program_ids)),
    'exercises', (select coalesce(jsonb_agg(jsonb_build_object('name', e.data->>'name', 'videoUrl', e.data->>'videoUrl', 'cues', e.data->>'cues')), '[]'::jsonb)
                  from exercises e where lower(trim(e.data->>'name')) = any(v_names)),
    'logs', (select coalesce(jsonb_agg(jsonb_build_object('programId', program_id, 'key', key, 'value', value)), '[]'::jsonb)
             from athlete_logs where athlete_id = v_id),
    'overrides', (select coalesce(jsonb_agg(jsonb_build_object('programId', program_id, 'exerciseId', exercise_id, 'data', data)), '[]'::jsonb)
                  from athlete_overrides where athlete_id = v_id),
    'rmChart', (select value from app_meta where key = 'rmChart')
  );
end $$;

-- Saves the same change for one or more exercises of a program on the athlete's plan (several when they choose
-- "for the rest of this phase"). A null p_data removes the change and puts the coach's version back.
create or replace function athlete_portal_override(p_token text, p_program_id text, p_exercise_ids text[], p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_ex text;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return false; end if;
  if p_exercise_ids is null or array_length(p_exercise_ids, 1) is null or array_length(p_exercise_ids, 1) > 60 then return false; end if;
  if not exists (
    select 1 from periodization pz, jsonb_array_elements(case when jsonb_typeof(pz.data->'blocks') = 'array' then pz.data->'blocks' else '[]'::jsonb end) b
    where pz.athlete_id = v_id and b->>'programId' = p_program_id
  ) then return false; end if;

  if p_data is null or jsonb_typeof(p_data) = 'null' then
    delete from athlete_overrides where athlete_id = v_id and program_id = p_program_id and exercise_id = any(p_exercise_ids);
    return true;
  end if;

  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 4000 then return false; end if;
  if length(trim(coalesce(p_data->>'name', ''))) not between 1 and 120 then return false; end if;
  if jsonb_typeof(p_data->'groups') <> 'array' or jsonb_array_length(p_data->'groups') > 12 then return false; end if;
  if (select count(*) from athlete_overrides where athlete_id = v_id) > 5000 then return false; end if;

  foreach v_ex in array p_exercise_ids loop
    if v_ex is null or length(v_ex) not between 1 and 60 then continue; end if;
    -- only exercises that are really in that program
    if not exists (
      select 1 from programs p, jsonb_path_query(p.data, '$.weeks[*].sessions[*].exercises[*].id') x
      where p.id = p_program_id and x #>> '{}' = v_ex
    ) then continue; end if;
    insert into athlete_overrides (athlete_id, program_id, exercise_id, data, source, updated_at)
    values (v_id, p_program_id, v_ex, p_data, 'athlete', now())
    on conflict (athlete_id, program_id, exercise_id)
    do update set data = excluded.data, source = 'athlete', updated_at = now();
  end loop;
  return true;
end $$;

-- Up to 20 exercise-library names matching what the athlete has typed (names that start with it first).
create or replace function athlete_portal_exercises(p_token text, p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
begin
  if p_token is null or length(p_token) < 32 then return '[]'::jsonb; end if;
  if not exists (select 1 from athlete_links where token = p_token) then return '[]'::jsonb; end if;
  if length(v_q) < 2 or length(v_q) > 60 then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'videoUrl', m.video, 'cues', m.cues) order by m.starts desc, m.name), '[]'::jsonb)
    from (
      select e.data->>'name' as name, e.data->>'videoUrl' as video, e.data->>'cues' as cues,
             (position(v_q in lower(e.data->>'name')) = 1) as starts
      from exercises e
      where position(v_q in lower(e.data->>'name')) > 0
      order by (position(v_q in lower(e.data->>'name')) = 1) desc, e.data->>'name'
      limit 20
    ) m
  );
end $$;

revoke all on function athlete_portal_get(text) from public;
revoke all on function athlete_portal_override(text, text, text[], jsonb) from public;
revoke all on function athlete_portal_exercises(text, text) from public;
grant execute on function athlete_portal_get(text) to anon, authenticated;
grant execute on function athlete_portal_override(text, text, text[], jsonb) to anon, authenticated;
grant execute on function athlete_portal_exercises(text, text) to anon, authenticated;
