-- Exercise videos filmed by coaches: a storage bucket for the clips a coach records from the phone app (the
-- camera button on an exercise with no video) or uploads in the dashboard's exercise library. A clip's address
-- is saved as the exercise's video link, so it plays wherever the exercise is programmed.
--   exercise-videos  public: anyone with a clip's exact (random) address can play it, which is how athletes'
--                    phone links play them without signing in. Only signed-in staff can add, replace or
--                    delete clips. Videos only, 50 MB at most each.
-- Run once in the SQL Editor. Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', true, 52428800, array['video/*'])
on conflict (id) do update
  set public = true, file_size_limit = 52428800, allowed_mime_types = array['video/*'];

drop policy if exists "staff add exercise videos" on storage.objects;
drop policy if exists "staff update exercise videos" on storage.objects;
drop policy if exists "staff delete exercise videos" on storage.objects;
create policy "staff add exercise videos" on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-videos');
create policy "staff update exercise videos" on storage.objects for update to authenticated
  using (bucket_id = 'exercise-videos');
create policy "staff delete exercise videos" on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-videos');
