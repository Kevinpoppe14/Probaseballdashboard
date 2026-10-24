-- The athlete's phone page (athlete.html) saves each speed drill's extra boxes (the ones the coach adds with the
-- speed builder's "+": Time, Height, Distance, Speed, or one they name) under keys like "<drill id>|x|time".
-- athlete_portal_log (migration_007) only took "<id>|<set>" and "<id>|<set>|r", so from a phone link those saves were
-- refused: the value was never stored, and the phone kept retrying it every 5 seconds, holding up every save queued
-- behind it. (Coach Mode writes athlete_logs directly, so it was never affected.)
-- This re-creates athlete_portal_log as before, but takes a key of up to four more "|" parts after the id, each any
-- text of up to 30 characters with no "|" or control characters (a coach's own box name can be "Load (lb)" or
-- "RPE/10"), with the whole key at most 160 characters. Every key the old check took is still taken.
-- Run once in the SQL Editor (after migration_007). Safe to run more than once.

create or replace function athlete_portal_log(p_token text, p_program_id text, p_key text, p_value text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_value text := left(trim(coalesce(p_value, '')), 24);
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return false; end if;
  if p_key is null or length(p_key) > 160
     or p_key !~ '^[^|[:cntrl:]]{1,60}(\|[^|[:cntrl:]]{1,30}){1,4}$' then return false; end if;
  if not exists (
    select 1 from periodization pz, jsonb_array_elements(case when jsonb_typeof(pz.data->'blocks') = 'array' then pz.data->'blocks' else '[]'::jsonb end) b
    where pz.athlete_id = v_id and b->>'programId' = p_program_id
  ) then return false; end if;
  -- a ceiling on rows per athlete, so a leaked link can't be used to fill the table
  if (select count(*) from athlete_logs where athlete_id = v_id) >= 20000
     and not exists (select 1 from athlete_logs where athlete_id = v_id and program_id = p_program_id and key = p_key)
  then return false; end if;

  insert into athlete_logs (athlete_id, program_id, key, value, source, updated_at)
  values (v_id, p_program_id, p_key, v_value, 'athlete', now())
  on conflict (athlete_id, program_id, key)
  do update set value = excluded.value, source = 'athlete', updated_at = now();
  return true;
end $$;

revoke all on function athlete_portal_log(text, text, text, text) from public;
grant execute on function athlete_portal_log(text, text, text, text) to anon, authenticated;
