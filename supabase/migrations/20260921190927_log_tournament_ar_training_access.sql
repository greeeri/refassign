create table if not exists public.tournament_ar_training_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  email text not null,
  first_name text not null,
  last_name text not null,
  accessed_at timestamptz not null default now()
);

create index if not exists tournament_ar_training_access_recent_idx
  on public.tournament_ar_training_access(accessed_at desc);
create index if not exists tournament_ar_training_access_official_idx
  on public.tournament_ar_training_access(official_id,accessed_at desc);

alter table public.tournament_ar_training_access enable row level security;
revoke all on table public.tournament_ar_training_access from public,anon,authenticated;
