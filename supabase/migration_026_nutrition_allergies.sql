-- Food allergies for the nutrition plan. The athlete's phone page asks about them the first time they open Nutrition
-- (athlete.html), and the plan (nutrition.js) is then built without those foods: no peanut butter or nuts for a nut
-- allergy, no fish or shrimp for seafood, and so on. Coaches can see and change them on the dashboard's Nutrition tab.
-- They're kept in assessments as their own record per athlete (kind "nutrition_prefs", id "nutprefs-<athlete id>"),
-- apart from the plan itself, so the dashboard saving a plan never writes over what the athlete answered:
--   { kind: "nutrition_prefs", athleteId, allergies: ["peanut", "treenut", ...], other: "", asked: true }
-- This adds the one token-checked function the phone uses to save them, for the link's own athlete.
-- Run once in the SQL Editor. Safe to run more than once.

create or replace function athlete_portal_set_allergies(p_token text, p_allergies jsonb, p_other text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_list jsonb;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select athlete_id into v_id from athlete_links where token = p_token;
  if v_id is null then return false; end if;
  -- only the allergies the plan knows; anything else goes in "other"
  select coalesce(jsonb_agg(distinct a), '[]'::jsonb) into v_list
  from jsonb_array_elements_text(case when jsonb_typeof(p_allergies) = 'array' then p_allergies else '[]'::jsonb end) a
  where a in ('peanut', 'treenut', 'fish', 'shellfish', 'dairy', 'egg', 'gluten', 'soy', 'sesame');

  insert into assessments (id, athlete_id, data, updated_at)
  values ('nutprefs-' || v_id, v_id, jsonb_build_object(
    'id', 'nutprefs-' || v_id, 'kind', 'nutrition_prefs',
    'athleteId', case when v_id ~ '^[0-9]+$' then to_jsonb(v_id::numeric) else to_jsonb(v_id) end,
    'allergies', v_list, 'other', left(coalesce(p_other, ''), 160), 'asked', true,
    'date', to_char(now(), 'YYYY-MM-DD'), 'source', 'athlete'
  ), now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

-- the athlete's answer, for the phone to show when the plan's own copy hasn't caught up yet
create or replace function athlete_portal_allergies(p_token text)
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
  return (select jsonb_build_object('allergies', a.data->'allergies', 'other', a.data->>'other', 'asked', true)
          from assessments a where a.id = 'nutprefs-' || v_id);
end $$;

revoke all on function athlete_portal_set_allergies(text, jsonb, text) from public;
revoke all on function athlete_portal_allergies(text) from public;
grant execute on function athlete_portal_set_allergies(text, jsonb, text) to anon, authenticated;
grant execute on function athlete_portal_allergies(text) to anon, authenticated;
