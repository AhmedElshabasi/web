-- Team owners may delete any team-scoped uploads/files (not only their own uploads).

-- upload_files: owner can delete rows for packages in teams they own
drop policy if exists "upload_files_delete_team_owner" on public.upload_files;
create policy "upload_files_delete_team_owner"
  on public.upload_files for delete
  to authenticated
  using (
    upload_id in (
      select u.id
      from public.uploads u
      where u.team_id is not null
        and exists (
          select 1
          from public.team_members tm
          where tm.team_id = u.team_id
            and tm.user_id = auth.uid()
            and tm.role = 'owner'
        )
    )
  );

-- uploads: owner can delete the package row (e.g. after last file removed)
drop policy if exists "uploads_delete_team_owner" on public.uploads;
create policy "uploads_delete_team_owner"
  on public.uploads for delete
  to authenticated
  using (
    team_id is not null
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = uploads.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'owner'
    )
  );

-- Storage: paths teams/<team_id>/<uploader_id>/<upload_id>/...
-- Owner may remove objects for their team (any uploader segment).
drop policy if exists "uploads_objects_delete_team_owner" on storage.objects;
create policy "uploads_objects_delete_team_owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and split_part(name, '/', 1) = 'teams'
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = split_part(name, '/', 2)::uuid
        and tm.user_id = auth.uid()
        and tm.role = 'owner'
    )
  );
