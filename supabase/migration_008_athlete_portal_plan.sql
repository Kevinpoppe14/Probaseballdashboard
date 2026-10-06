-- Lets the athlete phone page (athlete.html) show the athlete's player plan as well as their program:
-- athlete_portal_get now also hands back the plan's goals and action plan, every block on the timeline (not
-- only the ones with a program) with row and block colors, and the athlete's off-season facility name.
-- Coach notes on blocks are still left out.
-- Run once in the SQL Editor after migration_007. Safe to run more than once.

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

  select coalesce(array_agg(distinct lower(trim(n #>> '{}'))), '{}') into v_names
  from programs p, jsonb_path_query(p.data, '$.weeks[*].sessions[*].exercises[*].name') n
  where p.id = any(v_program_ids);

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
    'rmChart', (select value from app_meta where key = 'rmChart')
  );
end $$;

revoke all on function athlete_portal_get(text) from public;
grant execute on function athlete_portal_get(text) to anon, authenticated;
