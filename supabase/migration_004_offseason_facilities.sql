-- Adds an offseason_facilities table: the shared directory of off-season training facilities
-- (name, address, phone, website, contact, notes) that each Cubs athlete's facility is picked from.
-- Run once in the SQL Editor on a project that already has schema.sql applied. Safe to run more than once.
--
-- Same shape as the other tables in schema.sql: a text id plus a jsonb `data` column. Every field
-- lives inside `data`, so adding a new field later doesn't need another migration.

create table if not exists offseason_facilities (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table offseason_facilities enable row level security;

drop policy if exists "authenticated read offseason_facilities" on offseason_facilities;
drop policy if exists "authenticated write offseason_facilities" on offseason_facilities;
drop policy if exists "authenticated update offseason_facilities" on offseason_facilities;
drop policy if exists "authenticated delete offseason_facilities" on offseason_facilities;

create policy "authenticated read offseason_facilities" on offseason_facilities for select using (auth.role() = 'authenticated');
create policy "authenticated write offseason_facilities" on offseason_facilities for insert with check (auth.role() = 'authenticated');
create policy "authenticated update offseason_facilities" on offseason_facilities for update using (auth.role() = 'authenticated');
create policy "authenticated delete offseason_facilities" on offseason_facilities for delete using (auth.role() = 'authenticated');
