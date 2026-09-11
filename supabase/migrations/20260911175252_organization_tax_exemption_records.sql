create table if not exists public.organization_tax_exemptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  subscription_id uuid references public.refassign_subscriptions(id) on delete set null,
  purchaser_state text not null check (char_length(purchaser_state) = 2),
  exemption_basis text not null check (exemption_basis in ('iowa_commercial_enterprise')),
  exclusive_commercial_use_certified boolean not null default false,
  certificate_storage_path text not null,
  certificate_original_name text not null,
  status text not null default 'submitted' check (status in ('submitted','verified','rejected')),
  certified_by uuid not null references auth.users(id),
  certified_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  updated_at timestamptz not null default now()
);

alter table public.organization_tax_exemptions enable row level security;
revoke all on public.organization_tax_exemptions from anon, authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'tax-exemption-certificates',
  'tax-exemption-certificates',
  false,
  10485760,
  array['application/pdf','image/jpeg','image/png']
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

comment on table public.organization_tax_exemptions is
  'Private tax-exemption certifications submitted by organization owners. Access is server-mediated.';
