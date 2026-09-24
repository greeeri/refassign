-- Record the authenticated creator and keep ownership immutable so it can authorize deletion.
create or replace function public.stamp_availability_block_creator()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_availability_block_creator on public.official_availability_blocks;
create trigger stamp_availability_block_creator
before insert or update on public.official_availability_blocks
for each row execute function public.stamp_availability_block_creator();

drop policy if exists "Officials remove blocks they created" on public.official_availability_blocks;
create policy "Officials remove blocks they created"
on public.official_availability_blocks for delete to authenticated
using (
  created_by = (select auth.uid())
  and source_assignment_id is null
  and exists (
    select 1 from public.officials o
    where o.id = official_availability_blocks.official_id
      and o.auth_user_id = (select auth.uid())
  )
);

-- Existing update policies allow officials to edit their blocks. Prevent clearing a
-- decline block's assignment link to make it eligible for self removal.
drop policy if exists "Protect assignment blocks from official edits" on public.official_availability_blocks;
create policy "Protect assignment blocks from official edits"
on public.official_availability_blocks as restrictive for update to authenticated
using (
  (source_assignment_id is null and created_by = (select auth.uid())
    and exists (select 1 from public.officials o where o.id = official_availability_blocks.official_id and o.auth_user_id = (select auth.uid())))
  or exists (select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id = oo.organization_id
    where oo.official_id = official_availability_blocks.official_id and oo.active and m.user_id = (select auth.uid()) and m.role in ('owner','admin','assignor'))
)
with check (
  (source_assignment_id is null and created_by = (select auth.uid())
    and exists (select 1 from public.officials o where o.id = official_availability_blocks.official_id and o.auth_user_id = (select auth.uid())))
  or exists (select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id = oo.organization_id
    where oo.official_id = official_availability_blocks.official_id and oo.active and m.user_id = (select auth.uid()) and m.role in ('owner','admin','assignor'))
);
