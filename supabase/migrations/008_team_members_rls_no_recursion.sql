-- Fix: "infinite recursion detected in policy for relation team_members"
-- The previous SELECT policy queried team_members inside its own USING clause.
-- Users may only read their own membership rows; that is enough for teams/uploads RLS.

drop policy if exists "team_members_select_member" on public.team_members;
drop policy if exists "team_members_select_own" on public.team_members;

create policy "team_members_select_own"
  on public.team_members for select
  to authenticated
  using (user_id = auth.uid());
