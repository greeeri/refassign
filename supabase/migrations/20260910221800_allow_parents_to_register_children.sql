-- Pending under-13 registrations use a parent's email only to deliver consent.
-- Keep adult/referee emails unique, while identifying children by name and DOB.
drop index if exists public.official_registrations_email_year_program_idx;

create unique index official_registrations_email_year_program_idx
on public.official_registrations(lower(email),registration_year,registration_program_id)
where registration_program_id is not null and parent_consent_status <> 'pending';

create unique index official_registrations_child_year_program_idx
on public.official_registrations(lower(trim(first_name)),lower(trim(last_name)),date_of_birth,registration_year,registration_program_id)
where registration_program_id is not null and parent_email is not null and date_of_birth is not null;
