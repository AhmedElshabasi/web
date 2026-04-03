-- Allow team owners to delete a team (cascades memberships, uploads, related rows).

create or replace function public.delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'Not allowed';
  end if;
  delete from public.teams where id = p_team_id;
end;
$$;

grant execute on function public.delete_team(uuid) to authenticated;
