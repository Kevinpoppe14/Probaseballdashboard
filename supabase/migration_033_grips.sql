-- Grip screenshots: a picture of how an MLB pitcher holds a pitch, added by a coach beside that pitcher in the pitch
-- comps (bullpens.js, GripCell) and shown wherever that pitcher's pitch comes up as a comp. One per pitcher and pitch,
-- named "<MLB id>-<pitch code>" (e.g. 669713-ST.jpg).
--   grips   storage bucket, PUBLIC to read (grip photos aren't private, and a public link loads fastest); only signed-in
--           staff can add, replace or delete them. Images only, up to 10 MB each.
-- Run once in the SQL Editor. Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('grips', 'grips', true, 10485760, array['image/*'])
on conflict (id) do update
  set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/*'];

drop policy if exists "anyone read grips" on storage.objects;
drop policy if exists "staff add grips" on storage.objects;
drop policy if exists "staff update grips" on storage.objects;
drop policy if exists "staff delete grips" on storage.objects;
create policy "anyone read grips" on storage.objects for select using (bucket_id = 'grips');
create policy "staff add grips" on storage.objects for insert to authenticated with check (bucket_id = 'grips');
create policy "staff update grips" on storage.objects for update to authenticated using (bucket_id = 'grips');
create policy "staff delete grips" on storage.objects for delete to authenticated using (bucket_id = 'grips');
