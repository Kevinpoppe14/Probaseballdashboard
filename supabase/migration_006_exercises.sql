-- Adds an exercises table: the exercise library on the Programs tab (name, video link, tier, movement
-- pattern, body region, equipment, coaching cues). Exercises in programs link to it by name.
-- Run once in the SQL Editor on a project that already has schema.sql applied. Safe to run more than once.

create table if not exists exercises (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table exercises enable row level security;

drop policy if exists "authenticated read exercises" on exercises;
drop policy if exists "authenticated write exercises" on exercises;
drop policy if exists "authenticated update exercises" on exercises;
drop policy if exists "authenticated delete exercises" on exercises;

create policy "authenticated read exercises" on exercises for select using (auth.role() = 'authenticated');
create policy "authenticated write exercises" on exercises for insert with check (auth.role() = 'authenticated');
create policy "authenticated update exercises" on exercises for update using (auth.role() = 'authenticated');
create policy "authenticated delete exercises" on exercises for delete using (auth.role() = 'authenticated');
