-- The athlete's phone page (athlete.html) graphs their body composition on its Progress tab: their Evolt scans
-- (body_comp) and their manual body comp sheets (assessments with kind "bodycomp"). Both tables are readable by
-- signed-in staff only, so this adds one token-checked function that hands back, for the link's athlete only,
-- the figures the graph uses: the date, and weight, body fat, fat mass, lean mass and muscle. Nothing else from a
-- scan or a sheet (no skinfolds, notes, meal plans or who entered it) leaves the database.
-- Run once in the SQL Editor. Safe to run more than once.

create or replace function athlete_portal_body_comp(p_token text)
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
  return jsonb_build_object(
    'scans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', b.data->>'date',
        'time', b.data->>'time',
        'weightLb', b.data->'weightLb',
        'weightKg', b.data->'weightKg',
        'bodyFatPct', b.data->'bodyFatPct',
        'bodyFatLb', b.data->'bodyFatLb',
        'lbmLb', b.data->'lbmLb',
        'smmLb', b.data->'smmLb',
        'skeletalMuscleKg', b.data->'skeletalMuscleKg'
      ) order by b.data->>'date', b.data->>'time')
      from body_comp b
      where b.athlete_id = v_id
    ), '[]'::jsonb),
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', a.data->>'date',
        'summary', jsonb_build_object(
          'weightLb', a.data->'summary'->'weightLb',
          'pctFat', a.data->'summary'->'pctFat',
          'leanLb', a.data->'summary'->'leanLb',
          'fatLb', a.data->'summary'->'fatLb',
          'muscleLb', a.data->'summary'->'muscleLb'
        )
      ) order by a.data->>'date')
      from assessments a
      where a.athlete_id = v_id and a.data->>'kind' = 'bodycomp'
    ), '[]'::jsonb)
  );
end $$;

revoke all on function athlete_portal_body_comp(text) from public;
grant execute on function athlete_portal_body_comp(text) to anon, authenticated;
