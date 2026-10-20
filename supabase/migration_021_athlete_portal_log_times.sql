-- The athlete's phone page (athlete.html) shows a Training Log calendar on its Plan tab: each day they logged a
-- session. athlete_portal_get hands back what was logged but not when, so this adds one token-checked function that
-- hands back, for the link's athlete only, when each logged entry was last entered (program, key and time; no values).
-- Run once in the SQL Editor. Safe to run more than once.

create or replace function athlete_portal_log_times(p_token text)
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
    select jsonb_agg(jsonb_build_object('programId', l.program_id, 'key', l.key, 'at', l.updated_at))
    from athlete_logs l
    where l.athlete_id = v_id and l.value <> ''
  ), '[]'::jsonb);
end $$;

revoke all on function athlete_portal_log_times(text) from public;
grant execute on function athlete_portal_log_times(text) to anon, authenticated;
