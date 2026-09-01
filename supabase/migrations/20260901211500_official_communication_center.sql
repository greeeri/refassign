create table if not exists public.official_communications (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.assignments(id) on delete set null,
  game_id uuid references public.games(id) on delete set null,
  official_id uuid references public.officials(id) on delete set null,
  channel text not null check (channel in ('email','text')),
  message_type text not null check (message_type in ('confirmation_request','schedule_change','cancellation','reminder')),
  recipient text,
  subject text,
  provider_message_id text,
  delivery_status text not null default 'queued' check (delivery_status in ('queued','sent','delivered','opened','failed')),
  error_message text,
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists official_communications_game_created_idx on public.official_communications(game_id,created_at desc);
create index if not exists official_communications_assignment_created_idx on public.official_communications(assignment_id,created_at desc);
create unique index if not exists official_communications_provider_id_idx on public.official_communications(provider_message_id) where provider_message_id is not null;

alter table public.official_communications enable row level security;
drop policy if exists "Managers manage official communications" on public.official_communications;
create policy "Managers manage official communications" on public.official_communications for all to authenticated
using ((select public.can_manage_game_setup()))
with check ((select public.can_manage_game_setup()));
grant select,insert,update on public.official_communications to authenticated;
