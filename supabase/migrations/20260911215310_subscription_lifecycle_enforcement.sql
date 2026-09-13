alter table public.refassign_subscriptions
  add column if not exists access_override boolean not null default false,
  add column if not exists access_override_reason text,
  add column if not exists access_overridden_at timestamptz,
  add column if not exists access_overridden_by uuid references auth.users(id) on delete set null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processing_status text not null default 'processing' check (processing_status in ('processing','completed','failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;

create or replace function private.organization_has_operational_access(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1 from public.refassign_subscriptions
      where organization_id = p_organization_id
    )
    or coalesce((
      select access_override or status in ('active','trialing')
      from public.refassign_subscriptions
      where organization_id = p_organization_id
      order by created_at desc
      limit 1
    ), false);
$$;

revoke all on function private.organization_has_operational_access(uuid) from public, anon;
grant execute on function private.organization_has_operational_access(uuid) to authenticated;

create or replace function private.can_access_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin() or (
    private.organization_has_operational_access(p_organization_id)
    and (
      exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = p_organization_id
          and membership.user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.organization_officials organization_official
        join public.officials official on official.id = organization_official.official_id
        where organization_official.organization_id = p_organization_id
          and organization_official.active
          and official.auth_user_id = (select auth.uid())
      )
    )
  );
$$;

create or replace function private.can_manage_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin() or (
    private.organization_has_operational_access(p_organization_id)
    and exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = (select auth.uid())
        and membership.role in ('owner','admin')
    )
  );
$$;

create or replace function public.get_my_test_workspaces()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(workspace), '[]'::jsonb)
  from jsonb_array_elements(private.get_my_test_workspaces_impl()) workspace
  where private.organization_has_operational_access((workspace->>'organization_id')::uuid)
     or public.is_super_admin();
$$;

notify pgrst, 'reload schema';
