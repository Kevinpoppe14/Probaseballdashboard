-- Form checks: a remote athlete films a set from their phone page (athlete.html) and sends it to the coach who
-- assigned the program, who watches it in the dashboard and can reply. Clips and their records are kept for a week.
--   form-checks   storage bucket, PRIVATE: these are videos of athletes, so only signed-in staff can watch them
--                 (through short-lived signed links). Athletes upload through a one-time signed upload link that
--                 api/form-check.js hands out after checking their private link token. Videos only, 50 MB each.
--   form_checks   one row per clip: { path, programId, exerciseId, exercise, program, week, day, note, coach,
--                 reply, repliedBy, repliedAt, reviewed } for one athlete. Written by api/form-check.js (service
--                 role) and by staff replying in the dashboard.
--   athlete_portal_form_checks(token)  the athlete's own checks from the past week, with the coach's replies
--                 (no video links), so their phone page can show "Sent" and the reply under the exercise.
-- Run once in the SQL Editor. Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('form-checks', 'form-checks', false, 52428800, array['video/*'])
on conflict (id) do update
  set public = false, file_size_limit = 52428800, allowed_mime_types = array['video/*'];

drop policy if exists "staff read form checks" on storage.objects;
drop policy if exists "staff delete form checks" on storage.objects;
create policy "staff read form checks" on storage.objects for select to authenticated
  using (bucket_id = 'form-checks');
create policy "staff delete form checks" on storage.objects for delete to authenticated
  using (bucket_id = 'form-checks');

create table if not exists form_checks (
  id text primary key,
  athlete_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists form_checks_athlete_id_idx on form_checks (athlete_id);
create index if not exists form_checks_created_at_idx on form_checks (created_at);

alter table form_checks enable row level security;

drop policy if exists "authenticated read form_checks" on form_checks;
drop policy if exists "authenticated write form_checks" on form_checks;
drop policy if exists "authenticated update form_checks" on form_checks;
drop policy if exists "authenticated delete form_checks" on form_checks;
create policy "authenticated read form_checks" on form_checks for select using (auth.role() = 'authenticated');
create policy "authenticated write form_checks" on form_checks for insert with check (auth.role() = 'authenticated');
create policy "authenticated update form_checks" on form_checks for update using (auth.role() = 'authenticated');
create policy "authenticated delete form_checks" on form_checks for delete using (auth.role() = 'authenticated');

create or replace function athlete_portal_form_checks(p_token text)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'programId', f.data->>'programId',
      'exerciseId', f.data->>'exerciseId',
      'exercise', f.data->>'exercise',
      'note', f.data->>'note',
      'reply', f.data->>'reply',
      'repliedAt', f.data->>'repliedAt',
      'reviewed', coalesce((f.data->>'reviewed')::boolean, false),
      'at', f.created_at
    ) order by f.created_at)
    from form_checks f
    where f.athlete_id = v_id and f.created_at > now() - interval '7 days'
  ), '[]'::jsonb);
end $$;

revoke all on function athlete_portal_form_checks(text) from public;
grant execute on function athlete_portal_form_checks(text) to anon, authenticated;
