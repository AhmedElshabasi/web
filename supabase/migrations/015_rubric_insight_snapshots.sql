-- Holistic rubric workspace view: needs-attention list + quick breakdown (latest per team + rubric).

alter table public.ai_insight_runs
  add column if not exists needs_attention jsonb not null default '[]'::jsonb;

alter table public.ai_insight_runs
  add column if not exists quick_breakdown jsonb not null default '{}'::jsonb;

comment on column public.ai_insight_runs.needs_attention is 'AI flags for files/uploads needing follow-up at run time.';
comment on column public.ai_insight_runs.quick_breakdown is 'AI synthesis: completion, contributors, gaps.';

create table if not exists public.rubric_insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  rubric_upload_id uuid not null references public.uploads (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  last_eval_report_upload_id uuid references public.uploads (id) on delete set null,
  last_eval_report_file_id uuid references public.upload_files (id) on delete set null,
  last_eval_comment text,
  last_eval_score_percent smallint,
  model text,
  needs_attention jsonb not null default '[]'::jsonb,
  quick_breakdown jsonb not null default '{}'::jsonb,
  unique (team_id, rubric_upload_id),
  constraint rubric_insight_snapshots_score_chk check (
    last_eval_score_percent is null
    or (last_eval_score_percent >= 0 and last_eval_score_percent <= 100)
  )
);

create index if not exists rubric_insight_snapshots_team_idx
  on public.rubric_insight_snapshots (team_id);

alter table public.rubric_insight_snapshots enable row level security;

grant select, insert, update on public.rubric_insight_snapshots to authenticated;

create policy "rubric_insight_snapshots_select_team"
  on public.rubric_insight_snapshots for select
  to authenticated
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.team_id = rubric_insight_snapshots.team_id
        and tm.user_id = auth.uid()
    )
  );

create policy "rubric_insight_snapshots_insert_team"
  on public.rubric_insight_snapshots for insert
  to authenticated
  with check (
    auth.uid() = updated_by
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = rubric_insight_snapshots.team_id
        and tm.user_id = auth.uid()
    )
  );

create policy "rubric_insight_snapshots_update_team"
  on public.rubric_insight_snapshots for update
  to authenticated
  using (
    exists (
      select 1
      from public.team_members tm
      where tm.team_id = rubric_insight_snapshots.team_id
        and tm.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = updated_by
    and exists (
      select 1
      from public.team_members tm
      where tm.team_id = rubric_insight_snapshots.team_id
        and tm.user_id = auth.uid()
    )
  );

comment on table public.rubric_insight_snapshots is 'Latest holistic AI view per rubric within a team (needs attention + quick breakdown).';
