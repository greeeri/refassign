alter table public.development_modules
  drop constraint if exists development_modules_level_key_check;

alter table public.development_modules
  add constraint development_modules_level_key_check
  check (level_key in (
    'u8_referee','u10_referee','u11_ar','u12_ar','u13_referee','tournament_ar'
  ));

create or replace function public.can_start_development_module(
  p_module_id uuid,
  p_official_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  with target as (
    select module.program_id,
      module.level_key,
      case module.level_key
        when 'u8_referee' then 1 when 'u10_referee' then 2
        when 'u11_ar' then 3 when 'u12_ar' then 4 when 'u13_referee' then 5
      end as level_rank
    from public.development_modules module
    where module.id=p_module_id and module.active=true
  )
  select exists(select 1 from target)
    and (
      exists(select 1 from target where level_key='tournament_ar')
      or not exists(
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
      )
    );
$$;

revoke all on function public.can_start_development_module(uuid,uuid) from public,anon;
grant execute on function public.can_start_development_module(uuid,uuid) to authenticated;

do $$
declare
  v_program_id uuid;
  v_quiz_id uuid;
begin
  select id into v_program_id
  from public.registration_programs
  where slug='iowa-soccer';

  if v_program_id is null then
    raise exception 'Iowa Soccer registration program not found';
  end if;

  select id into v_quiz_id
  from public.training_quizzes
  where program_id=v_program_id and title='Assistant Referee Offside Assessment'
  order by created_at
  limit 1;

  if v_quiz_id is null then
    insert into public.training_quizzes(
      program_id,title,description,passing_percent,allow_retakes,active
    ) values (
      v_program_id,
      'Assistant Referee Offside Assessment',
      'Complete this 10-question assessment after reviewing the Offside training. A score of 80% is required to pass.',
      80,true,true
    ) returning id into v_quiz_id;
  end if;

  if not exists(select 1 from public.training_quiz_questions where quiz_id=v_quiz_id) then
    insert into public.training_quiz_questions(
      quiz_id,question_text,options,correct_option,explanation,sort_order
    ) values
    (v_quiz_id,'When is an attacker in an offside position?',
      '["Whenever the attacker is beyond the second-last opponent","When part of the head, body or feet is in the opponents’ half and nearer the goal line than both the ball and the second-last opponent","Whenever the attacker is closer to the goal line than the ball","When any part of the attacker, including an arm or hand, is beyond the second-last opponent"]'::jsonb,1,
      'The attacker must be in the opponents’ half and nearer the goal line than both the ball and the second-last opponent. Hands and arms are not considered.',1),
    (v_quiz_id,'An attacker is standing in an offside position when a teammate plays the ball but does not touch the ball, challenge an opponent or affect an opponent’s ability to play it. What should the assistant referee do?',
      '["Raise the flag immediately","Raise the flag when the ball crosses the halfway line","Keep the flag down and allow play to continue","Signal an indirect free kick at the attacker’s original position"]'::jsonb,2,
      'Being in an offside position is not an offence by itself. The player must become involved in active play.',2),
    (v_quiz_id,'From which group of restarts can a player receive the ball directly without committing an offside offence?',
      '["Goal kick, throw-in and corner kick","Kick-off, direct free kick and penalty kick","Dropped ball, indirect free kick and goal kick","Throw-in, kick-off and direct free kick"]'::jsonb,0,
      'There is no offside offence when a player receives the ball directly from a goal kick, throw-in or corner kick.',3),
    (v_quiz_id,'An attacker was in an offside position when a teammate shot. The attacker then plays the ball after it rebounds from the goalpost. What is the decision?',
      '["Continue play because the goalpost deliberately played the ball","Continue play unless the attacker scores","Award a dropped ball","Signal offside for gaining an advantage"]'::jsonb,3,
      'A rebound from the goalpost does not reset offside. Playing the rebound is gaining an advantage.',4),
    (v_quiz_id,'A defender sees a slowly moving pass, has time to control or clear it, but miskicks the ball to an attacker who had been in an offside position. What is the usual decision?',
      '["Offside because the defender’s kick was unsuccessful","Continue play because the defender deliberately played the ball","Award a direct free kick to the defending team","Stop play and restart with a dropped ball"]'::jsonb,1,
      'The clear view, manageable speed and time to coordinate indicate deliberate play. An inaccurate result does not negate deliberate play.',5),
    (v_quiz_id,'A defender instinctively stretches a leg toward a fast, unexpected pass and the ball merely deflects to an attacker who was in an offside position. What is the decision when the attacker plays it?',
      '["Continue because every intentional movement resets offside","Award a direct free kick for offside","Signal offside because the contact was a deflection rather than deliberate play","Allow play unless the attacker touches the ball twice"]'::jsonb,2,
      'Fast, unexpected service and instinctive limited contact indicate a deflection, which does not reset offside.',6),
    (v_quiz_id,'An attacker is in an offside position when a teammate shoots. The goalkeeper deliberately saves the shot, and the ball goes directly to that attacker. What should the assistant referee signal when the attacker plays the ball?',
      '["Offside for gaining an advantage from a deliberate save","No offside because the goalkeeper deliberately touched the ball","A corner kick","A dropped ball to the goalkeeper"]'::jsonb,0,
      'A deliberate save does not reset offside. Playing the saved ball is gaining an advantage.',7),
    (v_quiz_id,'During active play, what is the assistant referee’s normal offside-positioning reference?',
      '["The last defender at all times","The halfway line throughout the attack","The attacker nearest the goal","The second-last opponent or the ball, whichever is nearer the goal line"]'::jsonb,3,
      'The assistant referee stays level with the second-last opponent or the ball, whichever is nearer the goal line.',8),
    (v_quiz_id,'A player in an offside position runs toward a through ball, but an onside teammate also has a realistic opportunity to play it. What should the assistant referee generally do?',
      '["Flag as soon as the ball is passed","Delay the flag and judge who becomes involved","Signal a foul against both attackers","Stop play only if the goalkeeper requests it"]'::jsonb,1,
      'Waiting avoids incorrectly stopping play if the onside teammate reaches the ball and the offside-positioned player does not interfere.',9),
    (v_quiz_id,'An attacker in an offside position moves toward the ball but has not played it, attempted to play it or challenged an opponent. A defender fouls the attacker first. What is the correct decision?',
      '["Offside because the attacker was moving toward the ball","Allow play because an offside-positioned player cannot be fouled","Penalize the defender’s foul because it occurred before any offside offence","Restart with a dropped ball because both actions cancel out"]'::jsonb,2,
      'The defender’s foul is penalized because it occurred before the attacker committed an offside offence.',10);
  end if;

  insert into public.development_modules(
    program_id,title,description,category,resource_url,required,active,
    delivery_type,quiz_id,level_key,sort_order
  )
  select
    v_program_id,
    'Offside',
    'Tournament assistant referees review offside position, involvement, deliberate play, deflections, saves, positioning and delayed flags, then complete the assessment.',
    'Assistant Referee',
    'https://dgvzwrjvctueumdrxbpw.supabase.co/storage/v1/object/public/iowa-training-materials/materials/1789597923525-Offside_for_Teen_Referees_Optimized.pptx',
    true,true,'self_led',v_quiz_id,'tournament_ar',1
  where not exists(
    select 1 from public.development_modules
    where program_id=v_program_id and level_key='tournament_ar' and title='Offside'
  );
end
$$;
