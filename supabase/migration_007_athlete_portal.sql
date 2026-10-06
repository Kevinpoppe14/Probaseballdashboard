-- Athlete phone page (athlete.html): each athlete opens their program from a private link, with no account.
--   athlete_links  one unguessable token per athlete. A coach creates, resets or removes it from the dashboard.
--   athlete_logs   the weights and reps written in for each set, by the athlete (phone) or a coach (dashboard).
-- Nobody without a staff login can read either table. The phone page only ever calls the two functions at
-- the bottom, which check the token and hand back (or write) that one athlete's program data and nothing else.
-- Run once in the SQL Editor on a project that already has schema.sql applied. Safe to run more than once.

create table if not exists athlete_links (
  athlete_id text primary key,
  token text not null unique,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists athlete_logs (
  athlete_id text not null,
  program_id text not null,
  key text not null,          -- "<exercise id>|<set group>" for the weight, with "|r" added for reps reached
  value text not null default '',  -- '' means cleared
  source text not null default 'coach',  -- 'athlete' when written from the phone page
  updated_at timestamptz not null default now(),
  primary key (athlete_id, program_id, key)
);

alter table athlete_links enable row level security;
alter table athlete_logs enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['athlete_links','athlete_logs']
  loop
    execute format('drop policy if exists "authenticated read %1$s" on %1$I;', t);
    execute format('drop policy if exists "authenticated write %1$s" on %1$I;', t);
    execute format('drop policy if exists "authenticated update %1$s" on %1$I;', t);
    execute format('drop policy if exists "authenticated delete %1$s" on %1$I;', t);
    execute format('create policy "authenticated read %1$s" on %1$I for select using (auth.role() = ''authenticated'');', t);
    execute format('create policy "authenticated write %1$s" on %1$I for insert with check (auth.role() = ''authenticated'');', t);
    execute format('create policy "authenticated update %1$s" on %1$I for update using (auth.role() = ''authenticated'');', t);
    execute format('create policy "authenticated delete %1$s" on %1$I for delete using (auth.role() = ''authenticated'');', t);
  end loop;
end $$;

-- Everything the phone page shows for the athlete who owns this token: their name, the plan's timeline (rows
-- and blocks, without coach notes, goals or the action plan), the programs on it, the videos and cues for the
-- exercises in those programs, what has been logged, and the 1RM chart. Returns null for an unknown token.
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
    'athlete', jsonb_build_object('name', v_name),
    'plan', case when v_plan is null then null else jsonb_build_object(
      'startDate', v_plan->'startDate',
      'weeks', v_plan->'weeks',
      'lanes', (select coalesce(jsonb_agg(jsonb_build_object('id', l->'id', 'name', l->'name')), '[]'::jsonb)
                from jsonb_array_elements(case when jsonb_typeof(v_plan->'lanes') = 'array' then v_plan->'lanes' else '[]'::jsonb end) l),
      'blocks', (select coalesce(jsonb_agg(jsonb_build_object('id', b->'id', 'lane', b->'lane', 'start', b->'start', 'len', b->'len', 'label', b->'label', 'programId', b->'programId')), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(v_plan->'blocks') = 'array' then v_plan->'blocks' else '[]'::jsonb end) b
                 where coalesce(b->>'programId', '') <> ''),
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

-- Saves one written-in weight (or reps reached) for the athlete who owns this token. Only for a program that
-- is on their plan, and only short values. Returns false when nothing was saved.
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
  if p_key is null or p_key !~ '^[^|]{1,60}\|[0-9]{1,2}(\|r)?$' then return false; end if;
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

revoke all on function athlete_portal_get(text) from public;
revoke all on function athlete_portal_log(text, text, text, text) from public;
grant execute on function athlete_portal_get(text) to anon, authenticated;
grant execute on function athlete_portal_log(text, text, text, text) to anon, authenticated;
