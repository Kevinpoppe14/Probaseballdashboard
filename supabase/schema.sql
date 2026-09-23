-- Dynamic Sports Training dashboard — Supabase schema
-- Run this once in your project's SQL Editor (Supabase dashboard -> SQL Editor -> New query -> Run).
--
-- Design choice: each table is an id + a JSONB `data` column holding the same record shape the
-- app already keeps in localStorage (store.js), rather than a fully normalized column-per-field
-- schema. That's a deliberate tradeoff — it lets the app sync whole records with a couple of
-- generic functions instead of hand-mapping every field, which is what makes migrating an
-- already-working app to Supabase tractable in one pass. The cost is that you can't easily run
-- SQL reports against individual fields (e.g. "average grip strength across the roster") without
-- reaching into the JSON — if that kind of reporting becomes important later, the force_tests /
-- body_comp / manual_wellness tables are the ones worth normalizing first.
--
-- Access model: any authenticated (logged-in) user can read and write everything — one shared
-- team workspace, no per-user data separation. That matches "any logged-in coach sees everything."

create table if not exists athletes (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists force_tests (
  id text primary key,
  athlete_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists force_tests_athlete_id_idx on force_tests (athlete_id);

create table if not exists body_comp (
  id text primary key,
  athlete_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists body_comp_athlete_id_idx on body_comp (athlete_id);

create table if not exists manual_wellness (
  id text primary key,
  athlete_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists manual_wellness_athlete_id_idx on manual_wellness (athlete_id);

create table if not exists notes (
  id text primary key,
  athlete_id text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists player_plans (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per athlete (the app keys periodization plans by athlete id, not a separate id).
create table if not exists periodization (
  athlete_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists period_templates (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists assessments (
  id text primary key,
  athlete_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists assessments_athlete_id_idx on assessments (athlete_id);

-- Small key/value table for singleton settings (e.g. playerPlansSyncedAt).
create table if not exists app_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---- Row Level Security: any logged-in user can do anything; nobody logged out can do anything ----
alter table athletes enable row level security;
alter table force_tests enable row level security;
alter table body_comp enable row level security;
alter table manual_wellness enable row level security;
alter table notes enable row level security;
alter table player_plans enable row level security;
alter table periodization enable row level security;
alter table period_templates enable row level security;
alter table assessments enable row level security;
alter table app_meta enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['athletes','force_tests','body_comp','manual_wellness','notes',
                            'player_plans','periodization','period_templates','assessments','app_meta']
  loop
    execute format(
      'create policy "authenticated read" on %I for select using (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "authenticated write" on %I for insert with check (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "authenticated update" on %I for update using (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "authenticated delete" on %I for delete using (auth.role() = ''authenticated'');', t);
  end loop;
end $$;
