-- Activity log: note priority + file-deletion events (rubric-scoped timeline).

alter table public.upload_notes
  add column if not exists priority text not null default 'normal';

alter table public.upload_notes
  drop constraint if exists upload_notes_priority_chk;

alter table public.upload_notes
  add constraint upload_notes_priority_chk
  check (priority in ('low', 'normal', 'high', 'urgent'));

comment on column public.upload_notes.priority is 'Elevated priorities surface in Activity Log needs-attention.';

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  rubric_upload_id uuid references public.uploads (id) on delete set null,
  event_type text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_email text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_events_type_chk check (event_type in ('file_deleted'))
);

create index if not exists activity_events_team_rubric_created_idx
  on public.activity_events (team_id, rubric_upload_id, created_at desc);

create index if not exists activity_events_team_created_idx
  on public.activity_events (team_id, created_at desc);

alter table public.activity_events enable row level security;

grant select, insert on public.activity_events to authenticated;

create policy "activity_events_select_team"
  on public.activity_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.team_id = activity_events.team_id
        and tm.user_id = auth.uid()
    )
  );

create policy "activity_events_insert_team"
  on public.activity_events for insert
  to authenticated
  with check (
    auth.uid() = actor_user_id
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = activity_events.team_id
        and tm.user_id = auth.uid()
    )
  );

comment on table public.activity_events is 'Append-only team events for activity timeline (e.g. file_deleted).';

-- Log file removal while upload row still exists (call before deleting empty parent upload).
create or replace function public.log_file_deleted_event(
  p_upload_id uuid,
  p_file_id uuid,
  p_original_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  r_id uuid;
  uemail text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select u.team_id, u.linked_rubric_upload_id
  into t_id, r_id
  from public.uploads u
  where u.id = p_upload_id;

  if t_id is null then
    raise exception 'Upload not found';
  end if;

  if not exists (
    select 1
    from public.team_members tm
    where tm.team_id = t_id
      and tm.user_id = auth.uid()
  ) then
    raise exception 'Not a team member';
  end if;

  select email into uemail from auth.users where id = auth.uid();

  insert into public.activity_events (
    team_id,
    rubric_upload_id,
    event_type,
    actor_user_id,
    actor_email,
    payload
  )
  values (
    t_id,
    r_id,
    'file_deleted',
    auth.uid(),
    uemail,
    jsonb_build_object(
      'upload_id', p_upload_id,
      'file_id', p_file_id,
      'original_name', coalesce(p_original_name, '')
    )
  );
end;
$$;

grant execute on function public.log_file_deleted_event(uuid, uuid, text) to authenticated;
