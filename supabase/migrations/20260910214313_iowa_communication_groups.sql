create table if not exists public.development_communication_groups (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists development_communication_groups_name_idx
on public.development_communication_groups(program_id, lower(trim(name)));
alter table public.development_communication_groups
add constraint development_communication_groups_id_program_unique unique(id,program_id);

create table if not exists public.development_communication_group_members (
  group_id uuid not null,
  program_id uuid not null,
  official_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (group_id, official_id),
  foreign key(group_id,program_id) references public.development_communication_groups(id,program_id) on delete cascade,
  foreign key(program_id,official_id) references public.registration_program_officials(program_id,official_id) on delete cascade
);

alter table public.development_communication_groups enable row level security;
alter table public.development_communication_group_members enable row level security;

grant select, insert, update, delete on public.development_communication_groups to authenticated;
grant select, insert, delete on public.development_communication_group_members to authenticated;

create policy "Iowa staff read communication groups"
on public.development_communication_groups for select to authenticated
using (public.can_manage_registration_program(program_id));

create policy "Iowa staff create communication groups"
on public.development_communication_groups for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.can_manage_registration_program(program_id)
);

create policy "Iowa staff update communication groups"
on public.development_communication_groups for update to authenticated
using (public.can_manage_registration_program(program_id))
with check (
  public.can_manage_registration_program(program_id)
);

create policy "Iowa staff delete communication groups"
on public.development_communication_groups for delete to authenticated
using (public.can_manage_registration_program(program_id));

create policy "Iowa staff read communication group members"
on public.development_communication_group_members for select to authenticated
using (
  public.can_manage_registration_program(program_id)
);

create policy "Iowa staff add communication group members"
on public.development_communication_group_members for insert to authenticated
with check (
  public.can_manage_registration_program(program_id)
);

create policy "Iowa staff remove communication group members"
on public.development_communication_group_members for delete to authenticated
using (
  public.can_manage_registration_program(program_id)
);
