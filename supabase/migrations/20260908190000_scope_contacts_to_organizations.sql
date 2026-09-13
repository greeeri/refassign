alter table public.contacts
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.contacts
set organization_id = (
  select id from public.organizations where name = 'Test' order by created_at limit 1
)
where organization_id is null;

create index if not exists contacts_organization_id_idx
  on public.contacts (organization_id);

create unique index if not exists contacts_organization_email_unique
  on public.contacts (organization_id, lower(email));
