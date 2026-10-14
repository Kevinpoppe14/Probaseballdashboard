-- Merged exercises: in the dashboard's exercise library, two entries for the same exercise can be merged, and
-- the one kept answers to the other's name from then on (its data->'aliases' list). athlete_portal_get now
-- matches the exercises in an athlete's programs by those names too, so a program written with either wording
-- shows the kept exercise's video and cues on the athlete's phone. Nothing else in the function changes
-- (it is migration_010's, with the 'exercises' lookup widened).
-- Run once in the SQL Editor. Safe to run more than once.

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
    -- each program name that matches an exercise's name or one of the names merged into it, under that name
    'exercises', (select coalesce(jsonb_agg(jsonb_build_object('name', n.nm, 'videoUrl', e.data->>'videoUrl', 'cues', e.data->>'cues')), '[]'::jsonb)
                  from exercises e
                  cross join lateral (
                    select e.data->>'name' as nm
                    union
                    select a #>> '{}' from jsonb_array_elements(case when jsonb_typeof(e.data->'aliases') = 'array' then e.data->'aliases' else '[]'::jsonb end) a
                  ) n
                  where lower(trim(n.nm)) = any(v_names)),
    'logs', (select coalesce(jsonb_agg(jsonb_build_object('programId', program_id, 'key', key, 'value', value)), '[]'::jsonb)
             from athlete_logs where athlete_id = v_id),
    'overrides', (select coalesce(jsonb_agg(jsonb_build_object('programId', program_id, 'exerciseId', exercise_id, 'data', data)), '[]'::jsonb)
                  from athlete_overrides where athlete_id = v_id),
    'rmChart', (select value from app_meta where key = 'rmChart')
  );
end $$;

revoke all on function athlete_portal_get(text) from public;
grant execute on function athlete_portal_get(text) to anon, authenticated;
