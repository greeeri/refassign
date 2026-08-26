-- Split officials full_name into first_name and last_name while preserving existing data.

alter table public.officials add column if not exists first_name text;
alter table public.officials add column if not exists last_name text;

update public.officials
set
  first_name = case
    when first_name is null or btrim(first_name) = '' then split_part(btrim(full_name), ' ', 1)
    else first_name
  end,
  last_name = case
    when last_name is null or btrim(last_name) = '' then
      case
        when position(' ' in btrim(full_name)) > 0 then btrim(substr(btrim(full_name), position(' ' in btrim(full_name)) + 1))
        else ''
      end
    else last_name
  end;

alter table public.officials alter column first_name set not null;
alter table public.officials alter column last_name set not null;

create or replace function public.sync_official_full_name()
returns trigger
language plpgsql
as $$
begin
  new.full_name := btrim(concat_ws(' ', new.first_name, new.last_name));
  return new;
end;
$$;

drop trigger if exists officials_sync_full_name on public.officials;
create trigger officials_sync_full_name
before insert or update of first_name, last_name
on public.officials
for each row execute procedure public.sync_official_full_name();

update public.officials
set full_name = btrim(concat_ws(' ', first_name, last_name));

create index if not exists officials_last_name_idx on public.officials(last_name, first_name);
