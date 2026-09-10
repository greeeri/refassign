create table if not exists public.training_quizzes(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  title text not null,
  description text not null default '',
  passing_percent integer not null default 80 check(passing_percent between 1 and 100),
  allow_retakes boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_quiz_questions(
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.training_quizzes(id) on delete cascade,
  question_text text not null,
  options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options) between 2 and 6),
  correct_option integer not null check(correct_option between 0 and 5),
  explanation text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint training_quiz_correct_option_in_range check(correct_option < jsonb_array_length(options))
);

alter table public.development_modules
  add column if not exists quiz_id uuid references public.training_quizzes(id) on delete set null;

alter table public.development_quiz_attempts
  add column if not exists quiz_id uuid references public.training_quizzes(id) on delete set null;

create index if not exists training_quizzes_program_idx on public.training_quizzes(program_id,active,updated_at desc);
create index if not exists training_quiz_questions_quiz_idx on public.training_quiz_questions(quiz_id,sort_order);
create index if not exists development_quiz_attempts_quiz_idx on public.development_quiz_attempts(quiz_id,completed_at desc);

alter table public.training_quizzes enable row level security;
alter table public.training_quiz_questions enable row level security;
grant select,insert,update,delete on public.training_quizzes to authenticated;
grant select,insert,update,delete on public.training_quiz_questions to authenticated;

create policy "Program staff manage quiz repository" on public.training_quizzes
for all to authenticated
using(public.can_manage_registration_program(program_id))
with check(public.can_manage_registration_program(program_id));

create policy "Program staff manage quiz questions" on public.training_quiz_questions
for all to authenticated
using(exists(select 1 from public.training_quizzes quiz where quiz.id=quiz_id and public.can_manage_registration_program(quiz.program_id)))
with check(exists(select 1 from public.training_quizzes quiz where quiz.id=quiz_id and public.can_manage_registration_program(quiz.program_id)));

-- Attempts are inserted only by the server after it scores against the protected answer key.
-- Existing own-attempt and program-staff read policies continue to control the answer log.
