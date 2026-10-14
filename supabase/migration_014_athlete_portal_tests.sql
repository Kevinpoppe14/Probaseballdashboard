-- The athlete's phone page (athlete.html) shows their own Group Testing results on its Progress tab and calls
-- out a new best after a session. Those results live in kpi_entries (migration_011), which only signed-in staff
-- can read, so this adds one token-checked function that hands back the results for the link's athlete only:
-- the test, its unit, which way is better, the date and the numbers. Who entered it is left out.
-- Run once in the SQL Editor. Safe to run more than once.

create or replace function athlete_portal_tests(p_token text)
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
      'kpiId', k.data->>'kpiId',
      'kpiName', k.data->>'kpiName',
      'unit', k.data->>'unit',
      'better', k.data->>'better',
      'date', k.data->>'date',
      'best', k.data->'best',
      'avg', k.data->'avg',
      'value', k.data->'value'
    ) order by k.data->>'date')
    from kpi_entries k
    where k.athlete_id = v_id
  ), '[]'::jsonb);
end $$;

revoke all on function athlete_portal_tests(text) from public;
grant execute on function athlete_portal_tests(text) to anon, authenticated;
