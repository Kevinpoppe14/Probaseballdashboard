-- Group speed sessions run from Coach Mode (coach.html).
--   speed_sessions  one row per group per day: { groupId, group, date, title, items: [{ name, detail, notes }], notes, by }.
--                   This is the plan the coach leads the group through.
--   speed_logs      one row per athlete per session: that the athlete did it, with a copy of the session as it was
--                   run. The id is built from the athlete and the session, so logging "to all" again for a later
--                   group can never record the same athlete twice.
-- The list of groups (e.g. "DST North Pro Group") is kept in app_meta under "speedGroups".
-- Only signed-in staff can read or write these; athletes' phone links cannot reach them, so speed sessions never
-- show in the athlete app.
-- Run once in the SQL Editor. Safe to run more than once.

create table if not exists speed_sessions (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists speed_logs (
  id text primary key,
  athlete_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists speed_logs_athlete_id_idx on speed_logs (athlete_id);

alter table speed_sessions enable row level security;
alter table speed_logs enable row level security;

drop policy if exists "authenticated read speed_sessions" on speed_sessions;
drop policy if exists "authenticated write speed_sessions" on speed_sessions;
drop policy if exists "authenticated update speed_sessions" on speed_sessions;
drop policy if exists "authenticated delete speed_sessions" on speed_sessions;
create policy "authenticated read speed_sessions" on speed_sessions for select using (auth.role() = 'authenticated');
create policy "authenticated write speed_sessions" on speed_sessions for insert with check (auth.role() = 'authenticated');
create policy "authenticated update speed_sessions" on speed_sessions for update using (auth.role() = 'authenticated');
create policy "authenticated delete speed_sessions" on speed_sessions for delete using (auth.role() = 'authenticated');

drop policy if exists "authenticated read speed_logs" on speed_logs;
drop policy if exists "authenticated write speed_logs" on speed_logs;
drop policy if exists "authenticated update speed_logs" on speed_logs;
drop policy if exists "authenticated delete speed_logs" on speed_logs;
create policy "authenticated read speed_logs" on speed_logs for select using (auth.role() = 'authenticated');
create policy "authenticated write speed_logs" on speed_logs for insert with check (auth.role() = 'authenticated');
create policy "authenticated update speed_logs" on speed_logs for update using (auth.role() = 'authenticated');
create policy "authenticated delete speed_logs" on speed_logs for delete using (auth.role() = 'authenticated');
