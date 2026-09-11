create table if not exists public.organization_tax_exemption_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.refassign_subscriptions(id) on delete set null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  status text not null default 'submitted' check (status in ('submitted','verified','rejected','superseded')),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  superseded_at timestamptz
);

create index if not exists organization_tax_exemption_documents_org_date_idx
  on public.organization_tax_exemption_documents(organization_id,submitted_at desc);

alter table public.organization_tax_exemption_documents enable row level security;
revoke all on public.organization_tax_exemption_documents from anon, authenticated;

insert into public.organization_tax_exemption_documents (
  organization_id,subscription_id,storage_path,original_name,mime_type,
  file_size_bytes,status,submitted_by,submitted_at
)
select
  organization_id,subscription_id,certificate_storage_path,certificate_original_name,
  case
    when lower(certificate_original_name) like '%.pdf' then 'application/pdf'
    when lower(certificate_original_name) like '%.png' then 'image/png'
    else 'image/jpeg'
  end,
  1,status,certified_by,certified_at
from public.organization_tax_exemptions
on conflict (storage_path) do nothing;

comment on table public.organization_tax_exemption_documents is
  'Append-only history of private organization tax-exemption certificates. Access is server-mediated.';
