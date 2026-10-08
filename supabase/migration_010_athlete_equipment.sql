-- Equipment survey for remote athletes (DST Remote Training).
--   athlete_equipment  what one athlete has to train with: the ticked items, any they (or a coach) added by hand,
--                      when the athlete last filled it in on their phone, and when a coach was last emailed.
-- Kept in its own table, not on the athlete's record, so an athlete filling it in on their phone and a coach
-- editing that athlete on the dashboard can never overwrite each other.
-- athlete_portal_get now also says whether the athlete is remote and returns their equipment;
-- athlete_portal_equipment saves the survey from the phone page.
-- Run once in the SQL Editor after migration_009. Safe to run more than once.

create table if not exists athlete_equipment (
  athlete_id text primary key,
  access jsonb not null default '[]'::jsonb,   -- equipment they have (names)
  custom jsonb not null default '[]'::jsonb,   -- names added by hand, on top of the standard list
  surveyed_at timestamptz,                     -- when the athlete last submitted it from their phone
  alerted_at timestamptz,                      -- when a coach was last emailed about flagged exercises
  source text not null default 'coach',
  updated_at timestamptz not null default now()
);

alter table athlete_equipment enable row level security;

drop policy if exists "authenticated read athlete_equipment" on athlete_equipment;
drop policy if exists "authenticated write athlete_equipment" on athlete_equipment;
drop policy if exists "authenticated update athlete_equipment" on athlete_equipment;
drop policy if exists "authenticated delete athlete_equipment" on athlete_equipment;
create policy "authenticated read athlete_equipment" on athlete_equipment for select using (auth.role() = 'authenticated');
create policy "authenticated write athlete_equipment" on athlete_equipment for insert with check (auth.role() = 'authenticated');
create policy "authenticated update athlete_equipment" on athlete_equipment for update using (auth.role() = 'authenticated');
create policy "authenticated delete athlete_equipment" on athlete_equipment for delete using (auth.role() = 'authenticated');

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
  v_athlete jsonb;
  v_eq athlete_equipment%rowtype;
  v_program_ids text[];
  v_names text[];
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  select athlete_id, name into v_id, v_name from athlete_links where token = p_token;
  if v_id is null then return null; end if;

  select data into v_plan from periodization where athlete_id = v_id;
  select data into v_athlete from athletes where id = v_id;
  select * into v_eq from athlete_equipment where athlete_id = v_id;

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
      'offseasonFacility', v_athlete->>'offseasonFacility',
      'remote', coalesce(v_athlete->>'dstLocation', '') = 'DST Remote Training'),
    -- what they have: their own table row, or what a coach ticked on their record before that table existed
    'equipment', jsonb_build_object(
      'access', case when v_eq.athlete_id is not null then v_eq.access
                     when jsonb_typeof(v_athlete->'equipmentAccess') = 'array' then v_athlete->'equipmentAccess'
                     else null end,
      'custom', case when v_eq.athlete_id is not null then v_eq.custom
                     when jsonb_typeof(v_athlete->'equipmentCustom') = 'array' then v_athlete->'equipmentCustom'
                     else '[]'::jsonb end,
      'surveyedAt', v_eq.surveyed_at),
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

-- Saves the equipment survey for the athlete who owns this token: what they ticked, and anything they added.
-- Both are lists of short names. Returns false when nothing was saved.
create or replace function athlete_portal_equipment(p_token text, p_access jsonb, p_custom jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_ok boolean;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return false; end if;
  if jsonb_typeof(p_access) <> 'array' or jsonb_typeof(p_custom) <> 'array' then return false; end if;
  if jsonb_array_length(p_access) > 120 or jsonb_array_length(p_custom) > 60 then return false; end if;
  select bool_and(jsonb_typeof(x) = 'string' and length(x #>> '{}') between 1 and 60) into v_ok
  from jsonb_array_elements(p_access || p_custom) x;
  if v_ok is false then return false; end if;

  insert into athlete_equipment (athlete_id, access, custom, surveyed_at, source, updated_at)
  values (v_id, p_access, p_custom, now(), 'athlete', now())
  on conflict (athlete_id)
  do update set access = excluded.access, custom = excluded.custom, surveyed_at = now(), source = 'athlete', updated_at = now();
  return true;
end $$;

revoke all on function athlete_portal_get(text) from public;
revoke all on function athlete_portal_equipment(text, jsonb, jsonb) from public;
grant execute on function athlete_portal_get(text) to anon, authenticated;
grant execute on function athlete_portal_equipment(text, jsonb, jsonb) to anon, authenticated;
