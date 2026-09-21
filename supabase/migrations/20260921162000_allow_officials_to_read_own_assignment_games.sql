-- Let official-facing RPCs read the caller's own assignment context without
-- broadening access to other officials' assignments or unrelated games.

create or replace function private.is_own_assigned_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.assignments assignment
      join public.officials official on official.id = assignment.official_id
      where assignment.game_id = p_game_id
        and official.auth_user_id = (select auth.uid())
    );
$$;

revoke all on function private.is_own_assigned_game(uuid) from public, anon;
grant execute on function private.is_own_assigned_game(uuid) to authenticated;

drop policy if exists "Officials read own assigned games" on public.games;
create policy "Officials read own assigned games"
on public.games
for select
to authenticated
using (private.is_own_assigned_game(id));

drop policy if exists "Officials read own organization connections" on public.organization_officials;
create policy "Officials read own organization connections"
on public.organization_officials
for select
to authenticated
using (
  exists (
    select 1
    from public.officials official
    where official.id = organization_officials.official_id
      and official.auth_user_id = (select auth.uid())
  )
);
