-- File share packages + per-file metadata. Run in Supabase → SQL Editor after 001_profiles.sql (optional).
-- Matches src/app/(protected)/receive/page.tsx and src/components/FileShareDashboard.tsx.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  uploader_email text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.upload_files (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.uploads (id) on delete cascade,
  original_name text not null,
  mime text,
  size bigint,
  storage_path text not null
);

create index if not exists upload_files_upload_id_idx on public.upload_files (upload_id);

alter table public.uploads enable row level security;
alter table public.upload_files enable row level security;

-- ---------------------------------------------------------------------------
-- RLS: workspace demo — any signed-in user can see all packages/files.
-- Inserts only for own user_id / files under own uploads.
-- ---------------------------------------------------------------------------

drop policy if exists "uploads_select_authenticated" on public.uploads;
create policy "uploads_select_authenticated"
  on public.uploads for select
  to authenticated
  using (true);

drop policy if exists "uploads_insert_own" on public.uploads;
create policy "uploads_insert_own"
  on public.uploads for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "upload_files_select_authenticated" on public.upload_files;
create policy "upload_files_select_authenticated"
  on public.upload_files for select
  to authenticated
  using (true);

drop policy if exists "upload_files_insert_own_package" on public.upload_files;
create policy "upload_files_insert_own_package"
  on public.upload_files for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.uploads u
      where u.id = upload_id
        and u.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: bucket "uploads" + policies (getPublicUrl in the app needs public read)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "uploads_objects_select_public" on storage.objects;
create policy "uploads_objects_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'uploads');

drop policy if exists "uploads_objects_insert_authenticated" on storage.objects;
create policy "uploads_objects_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'uploads');
