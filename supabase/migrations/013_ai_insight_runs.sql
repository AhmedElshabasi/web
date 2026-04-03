-- Persist AI rubric-vs-report insight results for future Activity Log / timeline use.

create table if not exists public.ai_insight_runs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  rubric_upload_id uuid not null references public.uploads (id) on delete cascade,
  report_upload_id uuid not null references public.uploads (id) on delete cascade,
  report_file_id uuid not null references public.upload_files (id) on delete cascade,
  rubric_label_snapshot text,
  report_label_snapshot text,
  comment text not null,
  score_percent smallint not null check (score_percent >= 0 and score_percent <= 100),
  model text,
  created_at timestamptz not null default now()
);

create index if not exists ai_insight_runs_team_created_idx
  on public.ai_insight_runs (team_id, created_at desc);

alter table public.ai_insight_runs enable row level security;

grant select, insert on public.ai_insight_runs to authenticated;

create policy "ai_insight_runs_select_team"
  on public.ai_insight_runs for select
  to authenticated
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.team_id = ai_insight_runs.team_id
        and tm.user_id = auth.uid()
    )
  );

create policy "ai_insight_runs_insert_team"
  on public.ai_insight_runs for insert
  to authenticated
  with check (
    auth.uid() = created_by
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = ai_insight_runs.team_id
        and tm.user_id = auth.uid()
    )
  );

comment on table public.ai_insight_runs is 'AI-generated report vs rubric insights; scoped to team for activity timeline.';
