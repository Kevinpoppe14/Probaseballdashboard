-- Bullpen videos: Edgertronic clips of a bullpen's pitches, added on the Bullpens tab (bullpen_video.js) and synced
-- to the pitches of the TrackMan report. Which clip goes with which pitch is kept on the bullpen's own record (the
-- assessments row, data.video), so the only new thing here is where the clips live:
--   bullpen-videos   storage bucket, PRIVATE: videos of athletes, so only signed-in staff can add, watch (through
--                    short-lived signed links) or delete them. Videos only, up to 500 MB each. Supabase's own
--                    project-wide upload limit (Storage settings) also applies: on the free plan it can't go over
--                    50 MB, so a long video may need splitting into clips there.
-- Run once in the SQL Editor. Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bullpen-videos', 'bullpen-videos', false, 524288000, array['video/*'])
on conflict (id) do update
  set public = false, file_size_limit = 524288000, allowed_mime_types = array['video/*'];

drop policy if exists "staff read bullpen videos" on storage.objects;
drop policy if exists "staff add bullpen videos" on storage.objects;
drop policy if exists "staff delete bullpen videos" on storage.objects;
create policy "staff read bullpen videos" on storage.objects for select to authenticated
  using (bucket_id = 'bullpen-videos');
create policy "staff add bullpen videos" on storage.objects for insert to authenticated
  with check (bucket_id = 'bullpen-videos');
create policy "staff delete bullpen videos" on storage.objects for delete to authenticated
  using (bucket_id = 'bullpen-videos');
