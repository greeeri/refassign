create table public.official_cc_contacts (
  official_id uuid primary key references public.officials(id) on delete cascade,
  date_of_birth date,
  name text not null default '',
  email text,
  phone text,
  updated_at timestamptz not null default now(),
  check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$')
);
alter table public.official_cc_contacts enable row level security;
revoke all on public.official_cc_contacts from public, anon, authenticated;
grant select on public.official_cc_contacts to authenticated;
grant all on public.official_cc_contacts to service_role;
create policy "Referee and managers read CC settings" on public.official_cc_contacts for select to authenticated using (
  private.can_rank_official(official_id) or exists(select 1 from public.officials o where o.id=official_id and o.auth_user_id=(select auth.uid()))
);
create table public.official_cc_deliveries (
  id uuid primary key default gen_random_uuid(),
  official_id uuid not null references public.officials(id) on delete cascade,
  channel text not null check(channel in ('email','text')),
  recipient text,
  status text not null check(status in ('sent','failed','skipped')),
  error_message text,
  created_at timestamptz not null default now()
);
create index official_cc_deliveries_official_created on public.official_cc_deliveries(official_id,created_at desc);
alter table public.official_cc_deliveries enable row level security;
revoke all on public.official_cc_deliveries from public,anon,authenticated;
grant select on public.official_cc_deliveries to authenticated;
grant all on public.official_cc_deliveries to service_role;
create policy "Referee and managers read CC deliveries" on public.official_cc_deliveries for select to authenticated using (
  private.can_rank_official(official_id) or exists(select 1 from public.officials o where o.id=official_id and o.auth_user_id=(select auth.uid()))
);

-- Save atomically; clients cannot bypass age/contact validation with direct writes.
create function private.save_official_cc_contact(p_official_id uuid,p_date_of_birth date,p_name text,p_email text,p_phone text)
returns void language plpgsql security definer set search_path='' as $$
declare v_old public.official_cc_contacts; v_registration_birth date; v_name text:=trim(coalesce(p_name,'')); v_email text:=nullif(lower(trim(p_email)),''); v_phone text:=nullif(trim(p_phone),''); v_birth date;
begin
  if auth.uid() is null or not (private.can_rank_official(p_official_id) or exists(select 1 from public.officials where id=p_official_id and auth_user_id=auth.uid())) then raise exception 'Not authorized'; end if;
  perform 1 from public.officials where id=p_official_id for update;
  select * into v_old from public.official_cc_contacts where official_id=p_official_id;
  select max(date_of_birth) into v_registration_birth from public.official_registrations where official_id=p_official_id;
  v_birth:=coalesce(v_registration_birth,p_date_of_birth);
  if v_old.date_of_birth > (current_date-interval '13 years')::date and v_birth is distinct from v_old.date_of_birth then raise exception 'A recorded under-13 birth date cannot be cleared or changed here.'; end if;
  if v_birth>current_date then raise exception 'Date of birth cannot be in the future.'; end if;
  if (v_birth > (current_date-interval '13 years')::date or v_email is not null or v_phone is not null or v_name<>'') and (v_name='' or (v_email is null and v_phone is null)) then raise exception 'A CC contact name and email or mobile number are required for referees under 13 or when adding a contact.'; end if;
  insert into public.official_cc_contacts(official_id,date_of_birth,name,email,phone) values(p_official_id,v_birth,v_name,v_email,v_phone)
  on conflict(official_id) do update set date_of_birth=excluded.date_of_birth,name=excluded.name,email=excluded.email,phone=excluded.phone,updated_at=now();
end $$;
revoke all on function private.save_official_cc_contact(uuid,date,text,text,text) from public,anon;
grant execute on function private.save_official_cc_contact(uuid,date,text,text,text) to authenticated;
create function public.save_official_cc_contact(p_official_id uuid,p_date_of_birth date,p_name text,p_email text,p_phone text)
returns void language sql security invoker set search_path='' as $$select private.save_official_cc_contact(p_official_id,p_date_of_birth,p_name,p_email,p_phone);$$;
revoke all on function public.save_official_cc_contact(uuid,date,text,text,text) from public,anon;
grant execute on function public.save_official_cc_contact(uuid,date,text,text,text) to authenticated;

-- Registration approval links the referee only after signed parent consent.
create function private.sync_registration_cc_contact() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.official_id is null then return new; end if;
 if new.date_of_birth > (current_date-interval '13 years')::date then
   if new.parent_consent_status <> 'signed' or nullif(trim(new.parent_name),'') is null or nullif(trim(new.parent_email),'') is null then raise exception 'A signed parent contact is required for referees under 13.'; end if;
   insert into public.official_cc_contacts(official_id,date_of_birth,name,email) values(new.official_id,new.date_of_birth,trim(new.parent_name),lower(trim(new.parent_email)))
   on conflict(official_id) do update set date_of_birth=excluded.date_of_birth,name=case when official_cc_contacts.name='' then excluded.name else official_cc_contacts.name end,email=coalesce(official_cc_contacts.email,excluded.email),updated_at=now();
 elsif new.date_of_birth is not null then
   insert into public.official_cc_contacts(official_id,date_of_birth) values(new.official_id,new.date_of_birth) on conflict(official_id) do update set date_of_birth=excluded.date_of_birth,updated_at=now();
 end if;
 return new;
end $$;
revoke all on function private.sync_registration_cc_contact() from public,anon,authenticated;
create trigger sync_registration_cc_contact after insert or update of official_id,date_of_birth,parent_name,parent_email,parent_consent_status on public.official_registrations for each row execute function private.sync_registration_cc_contact();
insert into public.official_cc_contacts(official_id,date_of_birth,name,email)
select distinct on(official_id) official_id,date_of_birth,
 case when parent_consent_status='signed' then coalesce(parent_name,'') else '' end,
 case when parent_consent_status='signed' then lower(parent_email) else null end
from public.official_registrations where official_id is not null and date_of_birth is not null order by official_id,date_of_birth desc;
notify pgrst,'reload schema';
