create or replace function public.list_iowa_development_inbox()
returns table(item_type text,id uuid,official_id uuid,official_name text,body text,status text,created_at timestamptz,response text,responder_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_access_iowa_development_records() then raise exception 'Not authorized';end if;
  return query
  select inbox.item_type,inbox.id,inbox.official_id,inbox.official_name,inbox.body,
    inbox.status,inbox.item_created_at,inbox.response,inbox.responder_name
  from (
    select 'mentor_request'::text as item_type,request.id,request.official_id,
      official.full_name as official_name,coalesce(request.response,'') as body,
      request.status,request.requested_at as item_created_at,request.response,
      profile.full_name as responder_name
    from public.development_mentor_requests request
    join public.officials official on official.id=request.official_id
    left join public.profiles profile on profile.id=request.handled_by
    join public.registration_programs program on program.id=request.program_id
    where program.slug='iowa-soccer'
    union all
    select 'question'::text as item_type,question.id,question.official_id,
      official.full_name as official_name,question.question as body,
      question.status,question.asked_at as item_created_at,question.response,
      question.responder_name
    from public.development_questions question
    join public.officials official on official.id=question.official_id
    join public.registration_programs program on program.id=question.program_id
    where program.slug='iowa-soccer'
  ) inbox
  order by inbox.item_created_at desc;
end;
$$;
revoke all on function public.list_iowa_development_inbox() from public,anon;
grant execute on function public.list_iowa_development_inbox() to authenticated;
