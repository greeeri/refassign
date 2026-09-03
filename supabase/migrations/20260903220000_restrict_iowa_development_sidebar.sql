insert into public.registration_program_staff(user_id,program_id,role)
select '8a306e8d-70b6-4813-8e9d-d46e8ee77de9'::uuid,program.id,'admin'
from public.registration_programs program
where program.slug='iowa-soccer'
on conflict do nothing;

create or replace function public.is_iowa_soccer_development_staff()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.registration_program_staff staff
    join public.registration_programs program on program.id=staff.program_id
    join public.profiles profile on profile.id=staff.user_id
    where staff.user_id=(select auth.uid())
      and staff.role in ('admin','registrar')
      and program.slug='iowa-soccer'
      and program.active=true
      and profile.active=true
  );
$$;

revoke all on function public.is_iowa_soccer_development_staff() from public,anon;
grant execute on function public.is_iowa_soccer_development_staff() to authenticated;
