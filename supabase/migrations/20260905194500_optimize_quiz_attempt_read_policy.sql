drop policy if exists "Officials read own quiz attempts" on public.development_quiz_attempts;
drop policy if exists "Program staff read quiz attempts" on public.development_quiz_attempts;

create policy "Authorized users read quiz attempts" on public.development_quiz_attempts
for select to authenticated using(
  exists(select 1 from public.officials official
    where official.id=official_id and official.auth_user_id=(select auth.uid()))
  or exists(select 1 from public.development_modules module
    where module.id=module_id and public.can_manage_registration_program(module.program_id))
);
