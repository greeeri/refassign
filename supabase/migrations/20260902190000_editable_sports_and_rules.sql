drop policy if exists "Staff insert sport positions" on public.sport_positions;
drop policy if exists "Staff update sport positions" on public.sport_positions;
drop policy if exists "Staff delete sport positions" on public.sport_positions;

create policy "Staff insert sport positions"
on public.sport_positions for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'assignor')
      and active = true
  )
);

create policy "Staff update sport positions"
on public.sport_positions for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'assignor')
      and active = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'assignor')
      and active = true
  )
);

create policy "Staff delete sport positions"
on public.sport_positions for delete
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'assignor')
      and active = true
  )
);
