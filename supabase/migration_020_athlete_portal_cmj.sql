-- The athlete's phone page (athlete.html) graphs their countermovement jumps on its Progress tab, as the
-- dashboard's Performance Metrics tab does. force_tests is readable by signed-in staff only, so this adds one
-- token-checked function that hands back, for the link's athlete only, the figures the graphs use: the date, the
-- test type, and jump height, mRSI, peak power, relative peak power, system weight, takeoff velocity, propulsive
-- net impulse, jump momentum and countermovement depth (the last two from Hawkin's raw record when an older test
-- doesn't have them pulled out). Nothing else from a test leaves the database.
-- Run once in the SQL Editor. Safe to run more than once.

create or replace function athlete_portal_cmj(p_token text)
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
      'date', f.data->>'date',
      'testType', f.data->>'testType',
      'jumpHeight', f.data->'jumpHeight',
      'rsiModified', f.data->'rsiModified',
      'peakPower', f.data->'peakPower',
      'relativePeakPower', f.data->'relativePeakPower',
      'systemWeight', f.data->'systemWeight',
      'takeoffVelocity', f.data->'takeoffVelocity',
      'totalImpulse', f.data->'totalImpulse',
      'jumpMomentum', coalesce(f.data->'jumpMomentum', f.data->'raw'->'Jump Momentum(kg.m/s)'),
      'countermovementDepth', f.data->'countermovementDepth',
      'countermovementDepthM', f.data->'raw'->'Countermovement Depth(m)'
    ) order by f.data->>'date')
    from force_tests f
    where f.athlete_id = v_id
  ), '[]'::jsonb);
end $$;

revoke all on function athlete_portal_cmj(text) from public;
grant execute on function athlete_portal_cmj(text) to anon, authenticated;
