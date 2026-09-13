create table public.assignment_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sport_id uuid not null references public.sports(id) on delete cascade,
  league_id uuid references public.leagues(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignment_template_slots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.assignment_templates(id) on delete cascade,
  position_id uuid not null references public.sport_positions(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  sort_order integer not null default 0,
  unique (template_id, position_id)
);

create index assignment_templates_sport_league_idx
  on public.assignment_templates (sport_id, league_id, updated_at desc);
create index assignment_template_slots_template_idx
  on public.assignment_template_slots (template_id, sort_order);

alter table public.assignment_templates enable row level security;
alter table public.assignment_template_slots enable row level security;

revoke all on public.assignment_templates from anon;
revoke all on public.assignment_template_slots from anon;
grant select, insert, update, delete on public.assignment_templates to authenticated;
grant select, insert, update, delete on public.assignment_template_slots to authenticated;

create policy "Managers view assignment templates"
on public.assignment_templates for select to authenticated
using ((select public.can_manage_game_setup()));

create policy "Managers create assignment templates"
on public.assignment_templates for insert to authenticated
with check (
  (select public.can_manage_game_setup())
  and created_by = (select auth.uid())
);

create policy "Managers update assignment templates"
on public.assignment_templates for update to authenticated
using ((select public.can_manage_game_setup()))
with check ((select public.can_manage_game_setup()));

create policy "Managers delete assignment templates"
on public.assignment_templates for delete to authenticated
using ((select public.can_manage_game_setup()));

create policy "Managers view assignment template slots"
on public.assignment_template_slots for select to authenticated
using (
  (select public.can_manage_game_setup())
  and exists (
    select 1 from public.assignment_templates template
    where template.id = template_id
  )
);

create policy "Managers create assignment template slots"
on public.assignment_template_slots for insert to authenticated
with check (
  (select public.can_manage_game_setup())
  and exists (
    select 1 from public.assignment_templates template
    where template.id = template_id
  )
);

create policy "Managers update assignment template slots"
on public.assignment_template_slots for update to authenticated
using ((select public.can_manage_game_setup()))
with check ((select public.can_manage_game_setup()));

create policy "Managers delete assignment template slots"
on public.assignment_template_slots for delete to authenticated
using ((select public.can_manage_game_setup()));
