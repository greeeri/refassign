alter table public.assignments
  drop constraint if exists assignments_official_id_fkey;

alter table public.assignments
  add constraint assignments_official_id_fkey
  foreign key (official_id) references public.officials(id) on delete cascade;

notify pgrst, 'reload schema';
