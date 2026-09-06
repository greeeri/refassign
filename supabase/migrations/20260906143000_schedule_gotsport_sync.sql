create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists private;

create table if not exists public.schedule_sync_tokens (
  token uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz
);

alter table public.schedule_sync_tokens enable row level security;
revoke all on public.schedule_sync_tokens from public, anon, authenticated;

create or replace function private.trigger_gotsport_schedule_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
  v_request_id bigint;
begin
  delete from public.schedule_sync_tokens where expires_at < now() - interval '1 day';
  insert into public.schedule_sync_tokens default values returning token into v_token;
  select net.http_get(
    url := 'https://refassign-chi.vercel.app/api/cron/gotsport-schedule',
    headers := jsonb_build_object('x-schedule-token', v_token::text),
    timeout_milliseconds := 300000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function private.trigger_gotsport_schedule_sync() from public;

select cron.schedule(
  'refassign-gotsport-iowa-sync',
  '0 2,3,13,14,17,18,22,23 * * *',
  'select private.trigger_gotsport_schedule_sync()'
);
