-- Recalculate two-person crew fees when a game is reduced from three slots.
-- Paid history stays intact; the existing import function records pending corrections.
create or replace function private.split_game_fees_on_crew_reduction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_positions uuid[];
  v_fees numeric[];
  v_total_cents bigint;
  v_rows jsonb;
begin
  if old.officials_needed <> 3 or new.officials_needed <> 2 then
    return new;
  end if;
  select array_agg(p.id order by p.sort_order,p.id),
         array_agg(pay.amount order by p.sort_order,p.id)
    into v_positions,v_fees
    from (select id,sort_order from public.sport_positions
          where sport_id=new.sport_id order by sort_order,id limit 3) p
    left join public.game_position_pay pay on pay.game_id=new.id and pay.position_id=p.id;
  if coalesce(array_length(v_positions,1),0) <> 3 or
     v_fees[1] is null or v_fees[2] is null or v_fees[3] is null then
    return new;
  end if;
  v_total_cents := round((v_fees[1]+v_fees[2]+v_fees[3])*100);
  v_rows := jsonb_build_array(
    jsonb_build_object('game_id',new.id,'position_id',v_positions[1],
      'amount',((v_total_cents+1)/2)::numeric/100),
    jsonb_build_object('game_id',new.id,'position_id',v_positions[2],
      'amount',(v_total_cents/2)::numeric/100)
  );
  perform public.import_game_position_pay(new.organization_id,v_rows);
  return new;
end;
$$;
revoke all on function private.split_game_fees_on_crew_reduction() from public,anon,authenticated;
drop trigger if exists split_game_fees_on_crew_reduction on public.games;
create trigger split_game_fees_on_crew_reduction
after update of officials_needed on public.games
for each row when (old.officials_needed = 3 and new.officials_needed = 2)
execute function private.split_game_fees_on_crew_reduction();
