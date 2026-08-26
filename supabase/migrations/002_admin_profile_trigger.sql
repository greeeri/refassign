-- Automatically create a profile for every new Supabase Auth user.
-- The initial RefAssign owner account is promoted to admin by email.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when lower(new.email) = 'greeeri@gmail.com' then 'admin' else 'official' end,
    true
  )
  on conflict (id) do update
  set role = case
    when lower(new.email) = 'greeeri@gmail.com' then 'admin'
    else public.profiles.role
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- If the admin auth user already exists when this migration is run,
-- ensure its profile is created/promoted immediately.
insert into public.profiles (id, full_name, role, active)
select
  id,
  coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)),
  'admin',
  true
from auth.users
where lower(email) = 'greeeri@gmail.com'
on conflict (id) do update set role = 'admin', active = true;
