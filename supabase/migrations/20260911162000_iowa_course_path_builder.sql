create or replace function public.reorder_development_modules(p_updates jsonb)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_program_id uuid;
  v_count integer;
begin
  if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates)=0 then
    raise exception 'At least one module update is required';
  end if;

  select module.program_id into v_program_id
  from public.development_modules module
  where module.id=(p_updates->0->>'id')::uuid;

  if v_program_id is null or not public.can_manage_registration_program(v_program_id) then
    raise exception 'Not authorized';
  end if;

  select count(distinct module.program_id) into v_count
  from public.development_modules module
  join jsonb_array_elements(p_updates) item on module.id=(item->>'id')::uuid;
  if v_count <> 1 then raise exception 'All modules must belong to one program'; end if;

  update public.development_modules module
  set level_key=item.level_key,
      sort_order=item.sort_order,
      updated_at=now()
  from jsonb_to_recordset(p_updates) as item(id uuid,level_key text,sort_order integer)
  where module.id=item.id and module.program_id=v_program_id;
end;
$$;

revoke all on function public.reorder_development_modules(jsonb) from public,anon;
grant execute on function public.reorder_development_modules(jsonb) to authenticated;
