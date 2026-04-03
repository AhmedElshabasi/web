-- Realtime updates for Activity Log (multi-user + cross-tab). Safe to ignore "already exists" if re-run.

alter publication supabase_realtime add table public.ai_insight_runs;
alter publication supabase_realtime add table public.rubric_insight_snapshots;
alter publication supabase_realtime add table public.activity_events;
