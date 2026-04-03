-- Tag upload batches that are rubrics (for filtering / downstream use).

alter table public.uploads
  add column if not exists is_rubric boolean not null default false;

comment on column public.uploads.is_rubric is 'When true, this upload package is marked as a rubric.';
