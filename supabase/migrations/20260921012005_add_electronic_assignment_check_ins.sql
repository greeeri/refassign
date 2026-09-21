create table if not exists public.assignment_check_ins (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid not null default auth.uid() references auth.users(id)
);

alter table public.assignment_check_ins enable row level security;

grant select, insert, update, delete
on public.assignment_check_ins
to authenticated;

drop policy if exists "League managers read assignment check ins"
on public.assignment_check_ins;
create policy "League managers read assignment check ins"
on public.assignment_check_ins
for select
to authenticated
using (
  exists (
    select 1
    from public.assignments assignment
    join public.games game on game.id = assignment.game_id
    where assignment.id = assignment_check_ins.assignment_id
      and private.can_manage_organization_league(
        game.organization_id,
        game.league_id,
        (select auth.uid())
      )
  )
);

drop policy if exists "League managers add assignment check ins"
on public.assignment_check_ins;
create policy "League managers add assignment check ins"
on public.assignment_check_ins
for insert
to authenticated
with check (
  checked_in_by = (select auth.uid())
  and exists (
    select 1
    from public.assignments assignment
    join public.games game on game.id = assignment.game_id
    where assignment.id = assignment_check_ins.assignment_id
      and private.can_manage_organization_league(
        game.organization_id,
        game.league_id,
        (select auth.uid())
      )
  )
);

drop policy if exists "League managers update assignment check ins"
on public.assignment_check_ins;
create policy "League managers update assignment check ins"
on public.assignment_check_ins
for update
to authenticated
using (
  exists (
    select 1
    from public.assignments assignment
    join public.games game on game.id = assignment.game_id
    where assignment.id = assignment_check_ins.assignment_id
      and private.can_manage_organization_league(
        game.organization_id,
        game.league_id,
        (select auth.uid())
      )
  )
)
with check (
  checked_in_by = (select auth.uid())
  and exists (
    select 1
    from public.assignments assignment
    join public.games game on game.id = assignment.game_id
    where assignment.id = assignment_check_ins.assignment_id
      and private.can_manage_organization_league(
        game.organization_id,
        game.league_id,
        (select auth.uid())
      )
  )
);

drop policy if exists "League managers remove assignment check ins"
on public.assignment_check_ins;
create policy "League managers remove assignment check ins"
on public.assignment_check_ins
for delete
to authenticated
using (
  exists (
    select 1
    from public.assignments assignment
    join public.games game on game.id = assignment.game_id
    where assignment.id = assignment_check_ins.assignment_id
      and private.can_manage_organization_league(
        game.organization_id,
        game.league_id,
        (select auth.uid())
      )
  )
);

create index if not exists assignment_check_ins_checked_in_at_idx
on public.assignment_check_ins (checked_in_at desc);
