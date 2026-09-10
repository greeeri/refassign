create sequence if not exists public.support_ticket_number_seq start 1000;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('RA-' || nextval('public.support_ticket_number_seq')::text),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  category text not null check (category in ('technical','assignment','billing','account','reporting','other')),
  subject text not null check (char_length(subject) between 3 and 160),
  description text not null check (char_length(description) between 10 and 5000),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'new' check (status in ('new','reviewing','waiting_on_customer','in_progress','resolved','closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  page_url text,
  browser text,
  device text,
  last_error text,
  screenshot_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 5000),
  internal_note boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_requester_idx on public.support_tickets(requester_user_id,updated_at desc);
create index if not exists support_tickets_queue_idx on public.support_tickets(status,priority,updated_at desc);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id,created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

grant select,insert on public.support_tickets to authenticated;
grant update on public.support_tickets to authenticated;
grant select,insert on public.support_ticket_messages to authenticated;
grant usage,select on sequence public.support_ticket_number_seq to authenticated;

create policy "Customers create support tickets" on public.support_tickets for insert to authenticated
with check (requester_user_id=(select auth.uid()) and assigned_to is null and status='new');
create policy "Customers read own support tickets" on public.support_tickets for select to authenticated
using (requester_user_id=(select auth.uid()) or public.is_super_admin());
create policy "Super admins update support tickets" on public.support_tickets for update to authenticated
using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Ticket participants read messages" on public.support_ticket_messages for select to authenticated
using (exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.requester_user_id=(select auth.uid()) or public.is_super_admin()) and (not internal_note or public.is_super_admin())));
create policy "Customers reply to own tickets" on public.support_ticket_messages for insert to authenticated
with check (author_user_id=(select auth.uid()) and (not internal_note or public.is_super_admin()) and exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.requester_user_id=(select auth.uid()) or public.is_super_admin())));

create schema if not exists support_internal;
create or replace function support_internal.touch_support_ticket()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.support_tickets set updated_at=now(), status=case when new.internal_note then status when requester_user_id=new.author_user_id and status='waiting_on_customer' then 'reviewing' else status end where id=new.ticket_id;
  return new;
end; $$;
revoke all on function support_internal.touch_support_ticket() from public,anon,authenticated;
drop trigger if exists support_ticket_message_touch on public.support_ticket_messages;
create trigger support_ticket_message_touch after insert on public.support_ticket_messages for each row execute function support_internal.touch_support_ticket();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('support-ticket-screenshots','support-ticket-screenshots',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "Customers upload support screenshots" on storage.objects for insert to authenticated
with check (bucket_id='support-ticket-screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Customers read own support screenshots" on storage.objects for select to authenticated
using (bucket_id='support-ticket-screenshots' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.is_super_admin()));
