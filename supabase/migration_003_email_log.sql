-- Adds an email_log table so the daily activity digest (see api/weekly-activity-email.js — named
-- for the existing weekly-roster-email.js it sits alongside, even though this one runs daily) can
-- report on emails sent through the app (Email to Athlete, Email Team Report, the roster digest
-- itself). Nothing about sent emails was tracked anywhere before this. Run once in the SQL Editor
-- on a project that already has schema.sql and migration_002 applied. Safe to run more than once.

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  sent_by text,        -- the coach's email, or 'system' for an automated send (the weekly digest)
  to_email text not null,
  cc_email text,
  subject text,
  kind text,            -- 'athlete_tab' | 'team_report' | 'weekly_digest'
  athlete_name text,    -- set for kind = 'athlete_tab'
  tab text              -- 'assessment' | 'plan' | 'statcast' | 'performance', set for kind = 'athlete_tab'
);
alter table email_log enable row level security;
drop policy if exists "authenticated read email_log" on email_log;
create policy "authenticated read email_log" on email_log for select using (auth.role() = 'authenticated');
-- No insert/update/delete policy on purpose: every write to this table goes through the
-- service-role key (see api/send-athlete-email.js and api/weekly-roster-email.js), which bypasses
-- RLS entirely — a coach's own session can read the log but can't edit or fabricate entries in it.
