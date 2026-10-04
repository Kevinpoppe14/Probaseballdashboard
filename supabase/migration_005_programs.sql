-- Adds a programs table: reusable training program templates built in the Programs tab.
-- Each program is stored as one jsonb document: name, description, and weeks of sessions of exercises.
-- Run once in the SQL Editor on a project that already has schema.sql applied. Safe to run more than once.

create table if not exists programs (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table programs enable row level security;

drop policy if exists "authenticated read programs" on programs;
drop policy if exists "authenticated write programs" on programs;
drop policy if exists "authenticated update programs" on programs;
drop policy if exists "authenticated delete programs" on programs;

create policy "authenticated read programs" on programs for select using (auth.role() = 'authenticated');
create policy "authenticated write programs" on programs for insert with check (auth.role() = 'authenticated');
create policy "authenticated update programs" on programs for update using (auth.role() = 'authenticated');
create policy "authenticated delete programs" on programs for delete using (auth.role() = 'authenticated');
