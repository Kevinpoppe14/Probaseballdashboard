-- KPI results logged from the Coach Board (coach.html): a quick way to record something a group did that is not
-- part of anyone's program, such as a 10-yard start time or a jump height.
--   kpi_entries  one row per result: { kpiId, kpiName, unit, value, date, by } for one athlete.
-- The list of KPIs to pick from (name, unit, whether lower or higher is better) is kept in app_meta under
-- "kpiDefs", so a KPI a coach creates shows up in everyone's drop-down.
-- Only signed-in staff can read or write these; athletes' phone links cannot reach them.
-- Run once in the SQL Editor. Safe to run more than once.

create table if not exists kpi_entries (
  id text primary key,
  athlete_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists kpi_entries_athlete_id_idx on kpi_entries (athlete_id);

alter table kpi_entries enable row level security;

drop policy if exists "authenticated read kpi_entries" on kpi_entries;
drop policy if exists "authenticated write kpi_entries" on kpi_entries;
drop policy if exists "authenticated update kpi_entries" on kpi_entries;
drop policy if exists "authenticated delete kpi_entries" on kpi_entries;
create policy "authenticated read kpi_entries" on kpi_entries for select using (auth.role() = 'authenticated');
create policy "authenticated write kpi_entries" on kpi_entries for insert with check (auth.role() = 'authenticated');
create policy "authenticated update kpi_entries" on kpi_entries for update using (auth.role() = 'authenticated');
create policy "authenticated delete kpi_entries" on kpi_entries for delete using (auth.role() = 'authenticated');
