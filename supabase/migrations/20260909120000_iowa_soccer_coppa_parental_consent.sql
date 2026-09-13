-- COPPA-aware parental consent for Iowa Soccer registrations.
alter table public.official_registrations
  add column if not exists date_of_birth date,
  add column if not exists parent_name text,
  add column if not exists parent_email text,
  add column if not exists parent_consent_status text not null default 'not_required'
    check (parent_consent_status in ('not_required','pending','signed','declined'));

alter table public.official_registrations drop constraint if exists official_registrations_status_check;
alter table public.official_registrations add constraint official_registrations_status_check
  check (status in ('parent_consent_pending','payment_pending','paid','approved','rejected'));

create table if not exists public.parental_consents (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.official_registrations(id) on delete cascade,
  consent_token uuid not null unique default gen_random_uuid(),
  parent_name text not null,
  parent_email text not null,
  child_name text not null,
  notice_version text not null default '2026-09-09',
  status text not null default 'pending' check (status in ('pending','signed','declined','expired')),
  signed_name text,
  signed_at timestamptz,
  signature_ip inet,
  signature_user_agent text,
  document_storage_path text unique,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parental_consents_status_created_idx
  on public.parental_consents(status, created_at desc);

alter table public.parental_consents enable row level security;
grant select on public.parental_consents to authenticated;

create policy "Registration staff read parental consents"
on public.parental_consents for select to authenticated
using (exists (
  select 1 from public.official_registrations registration
  where registration.id=registration_id
    and public.can_manage_registration_program(registration.registration_program_id)
));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('referee-private-documents','referee-private-documents',false,5242880,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy "Registration staff read private referee documents"
on storage.objects for select to authenticated
using(bucket_id='referee-private-documents' and exists(
  select 1 from public.parental_consents consent
  join public.official_registrations registration on registration.id=consent.registration_id
  where consent.document_storage_path=name
    and public.can_manage_registration_program(registration.registration_program_id)
));

-- Only trusted server code creates these files. No authenticated-client upload policy.

create or replace function public.approve_official_registration(p_registration_id uuid,p_level_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_registration public.official_registrations;v_official_id uuid;
begin
  select * into v_registration from public.official_registrations where id=p_registration_id for update;
  if v_registration.id is null then raise exception 'Registration not found';end if;
  if not public.can_manage_registration_program(v_registration.registration_program_id) then raise exception 'Not authorized';end if;
  if v_registration.parent_consent_status='pending' then raise exception 'Parent consent must be signed before approval';end if;
  if v_registration.payment_status<>'paid' then raise exception 'Registration must be marked paid before approval';end if;
  select id into v_official_id from public.officials where lower(email)=lower(v_registration.email) limit 1;
  if v_official_id is null then
    insert into public.officials(first_name,last_name,full_name,email,phone,home_address,home_city,home_state,home_zip,sports,active)
    values(v_registration.first_name,v_registration.last_name,v_registration.first_name||' '||v_registration.last_name,
      v_registration.email,v_registration.phone,v_registration.home_address,v_registration.home_city,
      v_registration.home_state,v_registration.home_zip,array[v_registration.sport],true) returning id into v_official_id;
  else
    update public.officials set first_name=v_registration.first_name,last_name=v_registration.last_name,
      full_name=v_registration.first_name||' '||v_registration.last_name,phone=coalesce(v_registration.phone,phone),
      home_address=coalesce(v_registration.home_address,home_address),home_city=coalesce(v_registration.home_city,home_city),
      home_state=coalesce(v_registration.home_state,home_state),home_zip=coalesce(v_registration.home_zip,home_zip),active=true
    where id=v_official_id;
  end if;
  insert into public.registration_program_officials(program_id,official_id,source,added_by)
  values(v_registration.registration_program_id,v_official_id,'registration',auth.uid()) on conflict do nothing;
  insert into public.official_level_eligibility(official_id,level_id)
  select v_official_id,requested.level_id from unnest(coalesce(p_level_ids,array[]::uuid[])) requested(level_id)
  join public.levels level on level.id=requested.level_id and level.active=true on conflict do nothing;
  update public.official_registrations set official_id=v_official_id,status='approved',reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now()
  where id=p_registration_id;
  return v_official_id;
end;
$$;
