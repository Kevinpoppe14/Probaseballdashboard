-- Motion capture: what a saved session needs to be opened again in full (mocap.js). The session's record (numbers,
-- moments, thinned curves) is an assessments row (kind "mocap"); the body points tracked on every frame, and the
-- video if the coach keeps it, go here:
--   mocap   storage bucket, PRIVATE: signed-in staff add, read (through short-lived links) and delete. JSON (the
--           tracking) and video, up to 500 MB each (Supabase's project-wide upload limit also applies: 50 MB at most
--           on the free plan, so a long video may not fit, and the session then reopens with the skeleton alone).
-- Run once in the SQL Editor. Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mocap', 'mocap', false, 524288000, array['video/*', 'application/json'])
on conflict (id) do update
  set public = false, file_size_limit = 524288000, allowed_mime_types = array['video/*', 'application/json'];

drop policy if exists "staff read mocap" on storage.objects;
drop policy if exists "staff add mocap" on storage.objects;
drop policy if exists "staff update mocap" on storage.objects;
drop policy if exists "staff delete mocap" on storage.objects;
create policy "staff read mocap" on storage.objects for select to authenticated using (bucket_id = 'mocap');
create policy "staff add mocap" on storage.objects for insert to authenticated with check (bucket_id = 'mocap');
create policy "staff update mocap" on storage.objects for update to authenticated using (bucket_id = 'mocap');
create policy "staff delete mocap" on storage.objects for delete to authenticated using (bucket_id = 'mocap');
