-- A quoted amount belongs to a game's position even before an official accepts it.
create table if not exists public.game_position_pay (
  game_id uuid not null references public.games(id) on delete cascade,
  position_id uuid not null references public.sport_positions(id),
  amount numeric(10,2) not null default 0 check (amount >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','void')),
  primary key (game_id, position_id)
);

create index if not exists game_position_pay_position_idx on public.game_position_pay(position_id);
alter table public.game_position_pay enable row level security;
-- The scoped server routes manage these values; officials see their assignment.game_fee.
revoke all on public.game_position_pay from anon, authenticated;

create or replace function private.default_game_position_fee()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and coalesce(new.game_fee, 0) = 0 then
    select amount into new.game_fee from public.game_position_pay
    where game_id = new.game_id and position_id = new.position_id;
    new.game_fee := coalesce(new.game_fee, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists default_game_position_fee on public.assignments;
create trigger default_game_position_fee before insert on public.assignments
for each row execute function private.default_game_position_fee();
