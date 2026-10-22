-- The athlete's phone page (athlete.html) shows their nutrition plan on its Nutrition tab. The plan is built on the
-- dashboard (nutrition.js), which saves it in assessments with kind "nutrition", along with a copy written out for
-- the phone: the day's targets, each meal's targets, the example meal rotation, the macro lists, the breakfast,
-- snack and shake options and the grocery list. Assessments are readable by signed-in staff only, so this adds one
-- token-checked function that hands back that copy, for the link's athlete only. Nothing else from the plan or
-- from their body composition leaves the database.
-- Run once in the SQL Editor. Safe to run more than once.

create or replace function athlete_portal_nutrition(p_token text)
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
  return (
    select a.data->'snapshot'
    from assessments a
    where a.athlete_id = v_id and a.data->>'kind' = 'nutrition' and a.data ? 'snapshot' and coalesce(a.data->>'goal', '') <> ''
    order by a.data->>'date' desc
    limit 1
  );
end $$;

revoke all on function athlete_portal_nutrition(text) from public;
grant execute on function athlete_portal_nutrition(text) to anon, authenticated;
