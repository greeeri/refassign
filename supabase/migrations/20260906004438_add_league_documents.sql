-- League-specific documents and policies managed by RefAssign administrators and assignors.
create table if not exists public.league_documents (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  document_type text not null default 'policy' check (document_type in ('policy','form','guide','other')),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text,
  file_size bigint not null check (file_size between 1 and 20971520),
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists league_documents_league_created_idx
on public.league_documents(league_id, created_at desc);

alter table public.league_documents enable row level security;
grant select, insert, delete on public.league_documents to authenticated;

create or replace function public.can_read_league_document(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    public.is_refassign_staff()
    or public.is_super_admin()
    or exists (
      select 1
      from public.league_staff_access access
      where access.user_id = (select auth.uid())
        and access.league_id = p_league_id
    )
    or exists (
      select 1
      from public.officials official
      join public.official_league_eligibility eligibility
        on eligibility.official_id = official.id
      where official.auth_user_id = (select auth.uid())
        and official.active = true
        and eligibility.league_id = p_league_id
    )
  );
$$;
revoke all on function public.can_read_league_document(uuid) from public, anon;
grant execute on function public.can_read_league_document(uuid) to authenticated;

create policy "Authorized users read league documents"
on public.league_documents for select to authenticated
using (public.can_read_league_document(league_id));

create policy "Staff add league documents"
on public.league_documents for insert to authenticated
with check (public.is_refassign_staff() and uploaded_by = (select auth.uid()));

create policy "Staff remove league documents"
on public.league_documents for delete to authenticated
using (public.is_refassign_staff());

insert into storage.buckets (id, name, public, file_size_limit)
values ('league-documents', 'league-documents', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "Authorized users download league files"
on storage.objects for select to authenticated
using (
  bucket_id = 'league-documents'
  and exists (
    select 1
    from public.league_documents document
    where document.storage_path = name
      and public.can_read_league_document(document.league_id)
  )
);

create policy "Staff upload league files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'league-documents'
  and public.is_refassign_staff()
  and exists (
    select 1 from public.leagues league
    where league.id::text = (storage.foldername(name))[1]
  )
);

create policy "Staff remove league files"
on storage.objects for delete to authenticated
using (bucket_id = 'league-documents' and public.is_refassign_staff());
