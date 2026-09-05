alter table public.development_modules
  add column if not exists content_type text not null default 'resource'
    check(content_type in ('resource','quiz')),
  add column if not exists quiz_key text;

create unique index if not exists development_modules_program_quiz_key_idx
on public.development_modules(program_id,quiz_key) where quiz_key is not null;

create table if not exists public.development_quiz_attempts(
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.development_modules(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  quiz_key text not null,
  answers jsonb not null default '{}'::jsonb,
  correct_count integer not null check(correct_count>=0),
  total_questions integer not null check(total_questions>0),
  score_percent integer not null check(score_percent between 0 and 100),
  passed boolean not null,
  completed_at timestamptz not null default now()
);

create index if not exists development_quiz_attempts_official_idx
on public.development_quiz_attempts(official_id,module_id,completed_at desc);

alter table public.development_quiz_attempts enable row level security;
grant select on public.development_quiz_attempts to authenticated;

create policy "Officials read own quiz attempts" on public.development_quiz_attempts
for select to authenticated using(
  exists(select 1 from public.officials official
    where official.id=official_id and official.auth_user_id=(select auth.uid()))
);

create policy "Program staff read quiz attempts" on public.development_quiz_attempts
for select to authenticated using(
  exists(select 1 from public.development_modules module
    where module.id=module_id and public.can_manage_registration_program(module.program_id))
);

insert into public.development_modules(program_id,title,description,category,sort_order,required,active,delivery_type,content_type,quiz_key)
select program.id,
  'Entry-Level Soccer Rules Test',
  'Complete this 25-question beginner test covering field boundaries, restarts, offside, fouls, cards and player equipment. Score 80% or higher to pass.',
  'Laws of the Game',5,true,true,'self_led','quiz','iowa-entry-rules-2026'
from public.registration_programs program
where program.slug='iowa-soccer'
on conflict(program_id,quiz_key) where quiz_key is not null do update set
  title=excluded.title,
  description=excluded.description,
  category=excluded.category,
  required=true,
  active=true,
  content_type='quiz',
  updated_at=now();
