-- Allow users to delete their own upload_files rows and parent uploads when empty.
-- Allow deleting matching objects in storage bucket "uploads" (path demo/<user_id>/...).
--
-- NOTE: If you already ran an older version, run this whole script again (DROP/CREATE is idempotent).

-- Prefer IN (subquery): unqualified upload_id in EXISTS can fail to bind to the row under RLS.
drop policy if exists "upload_files_delete_own" on public.upload_files;
create policy "upload_files_delete_own"
  on public.upload_files for delete
  to authenticated
  using (
    upload_id in (
      select u.id
      from public.uploads u
      where u.user_id = auth.uid()
    )
  );

drop policy if exists "uploads_delete_own" on public.uploads;
create policy "uploads_delete_own"
  on public.uploads for delete
  to authenticated
  using (auth.uid() = user_id);

-- Path layout: demo/<auth.uid>/<upload_id>/...
drop policy if exists "uploads_objects_delete_own" on storage.objects;
create policy "uploads_objects_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and name like 'demo/' || auth.uid()::text || '/%'
  );
