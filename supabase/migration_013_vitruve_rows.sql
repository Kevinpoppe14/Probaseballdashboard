-- Velocity data brought in from Vitruve (a CSV exported from Vitruve Teams and imported on an athlete's Training
-- Log; later, the same rows could be filled by Vitruve's API).
--   vitruve_rows  one row per line of the export, usually one rep or one set:
--                 { source, date, exercise, set, rep, metrics: { column name: number }, text: { column name: text },
--                   file, importedBy, importedAt }
-- The id is built from the athlete, date, exercise, set and rep, so importing the same export again updates the
-- rows instead of doubling them.
-- Only signed-in staff can read or write these; athletes' phone links cannot reach them.
-- Run once in the SQL Editor. Safe to run more than once.

create table if not exists vitruve_rows (
  id text primary key,
  athlete_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists vitruve_rows_athlete_id_idx on vitruve_rows (athlete_id);

alter table vitruve_rows enable row level security;

drop policy if exists "authenticated read vitruve_rows" on vitruve_rows;
drop policy if exists "authenticated write vitruve_rows" on vitruve_rows;
drop policy if exists "authenticated update vitruve_rows" on vitruve_rows;
drop policy if exists "authenticated delete vitruve_rows" on vitruve_rows;
create policy "authenticated read vitruve_rows" on vitruve_rows for select using (auth.role() = 'authenticated');
create policy "authenticated write vitruve_rows" on vitruve_rows for insert with check (auth.role() = 'authenticated');
create policy "authenticated update vitruve_rows" on vitruve_rows for update using (auth.role() = 'authenticated');
create policy "authenticated delete vitruve_rows" on vitruve_rows for delete using (auth.role() = 'authenticated');
