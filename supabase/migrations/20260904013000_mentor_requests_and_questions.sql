create table if not exists public.development_mentor_requests(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','assigned','closed')),
  response text,
  handled_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists development_mentor_requests_one_pending_idx on public.development_mentor_requests(program_id,official_id) where status='pending';
alter table public.development_mentor_requests enable row level security;
grant select,insert,update on public.development_mentor_requests to authenticated;
create policy "Officials read own mentor requests" on public.development_mentor_requests for select to authenticated
using(exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid())) or public.can_access_iowa_development_records());
create policy "Officials request mentors" on public.development_mentor_requests for insert to authenticated
with check(exists(select 1 from public.officials official join public.registration_program_officials membership on membership.official_id=official.id where official.id=official_id and official.auth_user_id=(select auth.uid()) and membership.program_id=program_id));
create policy "Development team handles mentor requests" on public.development_mentor_requests for update to authenticated
using(public.can_access_iowa_development_records()) with check(public.can_access_iowa_development_records());

create table if not exists public.development_questions(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  question text not null check(length(trim(question)) between 1 and 5000),
  status text not null default 'open' check(status in ('open','answered','closed')),
  response text check(response is null or length(trim(response)) between 1 and 5000),
  responded_by uuid references auth.users(id) on delete set null,
  responder_name text,
  asked_at timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists development_questions_inbox_idx on public.development_questions(program_id,status,asked_at desc);
alter table public.development_questions enable row level security;
grant select,insert,update on public.development_questions to authenticated;
create policy "Officials read own development questions" on public.development_questions for select to authenticated
using(exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid())) or public.can_access_iowa_development_records());
create policy "Officials ask development questions" on public.development_questions for insert to authenticated
with check(exists(select 1 from public.officials official join public.registration_program_officials membership on membership.official_id=official.id where official.id=official_id and official.auth_user_id=(select auth.uid()) and membership.program_id=program_id));
create policy "Development team answers questions" on public.development_questions for update to authenticated
using(public.can_access_iowa_development_records()) with check(public.can_access_iowa_development_records());

create or replace function public.list_iowa_development_inbox()
returns table(item_type text,id uuid,official_id uuid,official_name text,body text,status text,created_at timestamptz,response text,responder_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_access_iowa_development_records() then raise exception 'Not authorized';end if;
  return query select * from (
  select 'mentor_request'::text,request.id,request.official_id,official.full_name,coalesce(request.response,''),request.status,request.requested_at,request.response,profile.full_name
  from public.development_mentor_requests request join public.officials official on official.id=request.official_id left join public.profiles profile on profile.id=request.handled_by
  join public.registration_programs program on program.id=request.program_id where program.slug='iowa-soccer'
  union all
  select 'question'::text,question.id,question.official_id,official.full_name,question.question,question.status,question.asked_at,question.response,question.responder_name
  from public.development_questions question join public.officials official on official.id=question.official_id
  join public.registration_programs program on program.id=question.program_id where program.slug='iowa-soccer'
  ) inbox order by inbox.created_at desc;
end;
$$;
revoke all on function public.list_iowa_development_inbox() from public,anon;
grant execute on function public.list_iowa_development_inbox() to authenticated;
