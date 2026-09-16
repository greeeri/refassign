alter table public.official_communications
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists message_body text;

update public.official_communications communication
set organization_id=game.organization_id
from public.games game
where communication.game_id=game.id
  and communication.organization_id is null;

alter table public.official_communications
  drop constraint if exists official_communications_message_type_check;

alter table public.official_communications
  add constraint official_communications_message_type_check
  check (message_type in ('custom','confirmation_request','schedule_change','cancellation','reminder'));

create index if not exists official_communications_organization_created_idx
  on public.official_communications(organization_id,created_at desc);

drop policy if exists "Managers manage official communications" on public.official_communications;
drop policy if exists "Managers read official communications" on public.official_communications;

create policy "Managers read official communications"
on public.official_communications for select to authenticated
using ((select private.can_manage_organization(organization_id)));

revoke all on table public.official_communications from anon, authenticated;
grant select on table public.official_communications to authenticated;

create table if not exists public.sms_consent_status (
  phone_e164 text primary key,
  status text not null check (status in ('opted_in','opted_out')),
  source text not null default 'twilio',
  updated_at timestamptz not null default now()
);

alter table public.sms_consent_status enable row level security;
revoke all on table public.sms_consent_status from anon, authenticated;
