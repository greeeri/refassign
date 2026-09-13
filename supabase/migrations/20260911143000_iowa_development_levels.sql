alter table public.development_modules
  add column if not exists level_key text not null default 'u8_referee';

alter table public.development_modules
  drop constraint if exists development_modules_level_key_check;

alter table public.development_modules
  add constraint development_modules_level_key_check
  check (level_key in ('u8_referee','u10_referee','u11_ar','u12_ar','u13_referee'));

create index if not exists development_modules_level_idx
  on public.development_modules(program_id,level_key,active,sort_order);

create or replace function public.can_start_development_module(p_module_id uuid,p_official_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  with target as (
    select module.program_id,
      case module.level_key
        when 'u8_referee' then 1 when 'u10_referee' then 2
        when 'u11_ar' then 3 when 'u12_ar' then 4 when 'u13_referee' then 5
      end as level_rank
    from public.development_modules module
    where module.id=p_module_id and module.active=true
  )
  select exists(select 1 from target)
    and not exists(
      select 1
      from target
      cross join (values (1),(2),(3),(4),(5)) as prior(level_rank)
      where prior.level_rank < target.level_rank
        and (
          not exists(
            select 1 from public.development_modules earlier
            where earlier.program_id=target.program_id and earlier.active=true
              and case earlier.level_key
                when 'u8_referee' then 1 when 'u10_referee' then 2
                when 'u11_ar' then 3 when 'u12_ar' then 4 when 'u13_referee' then 5
              end=prior.level_rank
          )
          or exists(
            select 1
            from public.development_modules earlier
            left join public.official_development_progress progress
              on progress.module_id=earlier.id and progress.official_id=p_official_id
            where earlier.program_id=target.program_id and earlier.active=true
              and case earlier.level_key
                when 'u8_referee' then 1 when 'u10_referee' then 2
                when 'u11_ar' then 3 when 'u12_ar' then 4 when 'u13_referee' then 5
              end=prior.level_rank
              and coalesce(progress.status,'not_started') <> 'completed'
          )
        )
    );
$$;

revoke all on function public.can_start_development_module(uuid,uuid) from public,anon;
grant execute on function public.can_start_development_module(uuid,uuid) to authenticated;

drop policy if exists "Officials start own development progress" on public.official_development_progress;
create policy "Officials start own development progress" on public.official_development_progress
for insert to authenticated with check(
  exists(
    select 1
    from public.officials official
    join public.registration_program_officials membership on membership.official_id=official.id
    join public.development_modules module on module.program_id=membership.program_id
    where official.id=official_id
      and official.auth_user_id=(select auth.uid())
      and module.id=module_id
  )
  and public.can_start_development_module(module_id,official_id)
);

drop policy if exists "Officials update own development progress" on public.official_development_progress;
create policy "Officials update own development progress" on public.official_development_progress
for update to authenticated
using(
  exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid()))
  and public.can_start_development_module(module_id,official_id)
)
with check(
  exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid()))
  and public.can_start_development_module(module_id,official_id)
);
