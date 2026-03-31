-- Teams: invite codes, membership, and team-scoped uploads.
-- Run after 006_upload_notes.sql. Replaces broad workspace RLS with team-based access.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Team',
  invite_code text not null unique,
  created_by uuid not null references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx on public.team_members (user_id);

alter table public.uploads add column if not exists team_id uuid references public.teams (id) on delete cascade;

create index if not exists uploads_team_id_idx on public.uploads (team_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- ---------------------------------------------------------------------------
-- RPC: create team + owner membership
-- ---------------------------------------------------------------------------

create or replace function public.create_team(p_name text default 'My team')
returns table (team_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  c text;
  attempts int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text || random()::text), 1, 8));
    exit when not exists (select 1 from public.teams t where t.invite_code = c);
    attempts := attempts + 1;
    if attempts > 80 then
      raise exception 'Could not generate invite code';
    end if;
  end loop;
  new_id := gen_random_uuid();
  insert into public.teams (id, name, invite_code, created_by)
  values (new_id, coalesce(nullif(trim(p_name), ''), 'My team'), c, auth.uid());
  insert into public.team_members (team_id, user_id, role)
  values (new_id, auth.uid(), 'owner');
  return query select new_id, c;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: join with invite code
-- ---------------------------------------------------------------------------

create or replace function public.join_team_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
  norm text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  norm := upper(trim(p_code));
  if length(norm) < 4 then
    raise exception 'Invalid code';
  end if;
  select id into tid from public.teams where invite_code = norm;
  if tid is null then
    raise exception 'Invalid code';
  end if;
  insert into public.team_members (team_id, user_id, role)
  values (tid, auth.uid(), 'member')
  on conflict (team_id, user_id) do nothing;
  return tid;
end;
$$;

grant execute on function public.create_team(text) to authenticated;
grant execute on function public.join_team_with_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: teams & members
-- ---------------------------------------------------------------------------

drop policy if exists "teams_select_member" on public.teams;
create policy "teams_select_member"
  on public.teams for select
  to authenticated
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.team_id = teams.id
        and tm.user_id = auth.uid()
    )
  );

-- SELECT must NOT reference team_members again (Postgres: infinite recursion in policy).
drop policy if exists "team_members_select_member" on public.team_members;
drop policy if exists "team_members_select_own" on public.team_members;
create policy "team_members_select_own"
  on public.team_members for select
  to authenticated
  using (user_id = auth.uid());

-- No direct inserts into teams / team_members from clients (use RPC).

-- ---------------------------------------------------------------------------
-- RLS: uploads & files — replace workspace-wide policies
-- ---------------------------------------------------------------------------

drop policy if exists "uploads_select_authenticated" on public.uploads;
drop policy if exists "uploads_insert_own" on public.uploads;
create policy "uploads_select_team"
  on public.uploads for select
  to authenticated
  using (
    (
      team_id is not null
      and exists (
        select 1
        from public.team_members tm
        where tm.team_id = uploads.team_id
          and tm.user_id = auth.uid()
      )
    )
    or (
      team_id is null
      and user_id = auth.uid()
    )
  );

create policy "uploads_insert_team"
  on public.uploads for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and team_id is not null
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = team_id
        and tm.user_id = auth.uid()
    )
  );

drop policy if exists "upload_files_select_authenticated" on public.upload_files;
drop policy if exists "upload_files_insert_own_package" on public.upload_files;
create policy "upload_files_select_team"
  on public.upload_files for select
  to authenticated
  using (
    exists (
      select 1
      from public.uploads u
      where u.id = upload_files.upload_id
        and (
          (
            u.team_id is not null
            and exists (
              select 1
              from public.team_members tm
              where tm.team_id = u.team_id
                and tm.user_id = auth.uid()
            )
          )
          or (u.team_id is null and u.user_id = auth.uid())
        )
    )
  );

create policy "upload_files_insert_team"
  on public.upload_files for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.uploads u
      where u.id = upload_id
        and u.user_id = auth.uid()
        and u.team_id is not null
        and exists (
          select 1
          from public.team_members tm
          where tm.team_id = u.team_id
            and tm.user_id = auth.uid()
        )
    )
  );

-- ---------------------------------------------------------------------------
-- upload_notes — scope to same visibility as uploads
-- ---------------------------------------------------------------------------

drop policy if exists "upload_notes_select_authenticated" on public.upload_notes;
create policy "upload_notes_select_team"
  on public.upload_notes for select
  to authenticated
  using (
    exists (
      select 1
      from public.uploads u
      where u.id = upload_notes.upload_id
        and (
          (
            u.team_id is not null
            and exists (
              select 1
              from public.team_members tm
              where tm.team_id = u.team_id
                and tm.user_id = auth.uid()
            )
          )
          or (u.team_id is null and u.user_id = auth.uid())
        )
    )
  );

drop policy if exists "upload_notes_insert_authenticated" on public.upload_notes;
create policy "upload_notes_insert_team"
  on public.upload_notes for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.uploads u
      where u.id = upload_id
        and (
          (
            u.team_id is not null
            and exists (
              select 1
              from public.team_members tm
              where tm.team_id = u.team_id
                and tm.user_id = auth.uid()
            )
          )
          or (u.team_id is null and u.user_id = auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: private reads for team paths + legacy demo/ paths for old objects
-- ---------------------------------------------------------------------------

update storage.buckets
set public = false
where id = 'uploads';

drop policy if exists "uploads_objects_select_public" on storage.objects;
drop policy if exists "uploads_objects_insert_authenticated" on storage.objects;
drop policy if exists "uploads_objects_delete_own" on storage.objects;

-- Team files: teams/<team_id>/<user_id>/<upload_id>/... — only uploader may insert/delete their objects.
create policy "uploads_objects_select_team"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'uploads'
    and split_part(name, '/', 1) = 'teams'
    and split_part(name, '/', 2) in (
      select tm.team_id::text
      from public.team_members tm
      where tm.user_id = auth.uid()
    )
  );

create policy "uploads_objects_insert_team"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'uploads'
    and split_part(name, '/', 1) = 'teams'
    and split_part(name, '/', 2) in (
      select tm.team_id::text
      from public.team_members tm
      where tm.user_id = auth.uid()
    )
    and split_part(name, '/', 3) = auth.uid()::text
  );

create policy "uploads_objects_delete_team"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and split_part(name, '/', 1) = 'teams'
    and split_part(name, '/', 3) = auth.uid()::text
    and split_part(name, '/', 2) in (
      select tm.team_id::text
      from public.team_members tm
      where tm.user_id = auth.uid()
    )
  );

-- Legacy uploads under demo/<user_id>/...
create policy "uploads_objects_select_demo_legacy"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'uploads'
    and name like 'demo/' || auth.uid()::text || '/%'
  );

create policy "uploads_objects_insert_demo_legacy"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'uploads'
    and name like 'demo/' || auth.uid()::text || '/%'
  );

create policy "uploads_objects_delete_demo_legacy"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and name like 'demo/' || auth.uid()::text || '/%'
  );

-- ---------------------------------------------------------------------------
-- Realtime (ignore errors if already added)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.teams;
alter publication supabase_realtime add table public.team_members;
