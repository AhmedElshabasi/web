-- Tie report batches to the rubric used when generating AI insights (for per-rubric activity / filtering).

alter table public.uploads
  add column if not exists linked_rubric_upload_id uuid references public.uploads (id) on delete set null;

comment on column public.uploads.linked_rubric_upload_id is
  'For non-rubric uploads: rubric package this report was last evaluated against via Generate insights.';

alter table public.uploads
  drop constraint if exists uploads_linked_rubric_only_for_reports_chk;

alter table public.uploads
  add constraint uploads_linked_rubric_only_for_reports_chk
  check (coalesce(is_rubric, false) = false or linked_rubric_upload_id is null);

create index if not exists uploads_linked_rubric_upload_id_idx
  on public.uploads (linked_rubric_upload_id)
  where linked_rubric_upload_id is not null;

-- Secure link: same team, report vs rubric, caller is team member. Only updates the link column.
create or replace function public.link_report_upload_to_rubric(
  p_report_upload_id uuid,
  p_rubric_upload_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_team uuid;
  r_is_rubric boolean;
  ru_team uuid;
  ru_is_rubric boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select team_id, coalesce(is_rubric, false)
  into r_team, r_is_rubric
  from public.uploads
  where id = p_report_upload_id;

  if r_team is null then
    raise exception 'Report upload not found';
  end if;

  if r_is_rubric then
    raise exception 'Not a report upload';
  end if;

  select team_id, coalesce(is_rubric, false)
  into ru_team, ru_is_rubric
  from public.uploads
  where id = p_rubric_upload_id;

  if ru_team is null then
    raise exception 'Rubric upload not found';
  end if;

  if ru_team <> r_team then
    raise exception 'Rubric and report must belong to the same team';
  end if;

  if not ru_is_rubric then
    raise exception 'Target upload is not a rubric';
  end if;

  if not exists (
    select 1
    from public.team_members tm
    where tm.team_id = r_team
      and tm.user_id = auth.uid()
  ) then
    raise exception 'Not a member of this team';
  end if;

  update public.uploads
  set linked_rubric_upload_id = p_rubric_upload_id
  where id = p_report_upload_id;
end;
$$;

grant execute on function public.link_report_upload_to_rubric(uuid, uuid) to authenticated;
