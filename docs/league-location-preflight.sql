-- READ ONLY. Run immediately before the approved migration against the intended project.
-- Expected outcome: zero rows. Any row means the deployed baseline drifted; review
-- the changed definition and regenerate/retest instead of overwriting it blindly.
-- Fingerprints were captured read-only from the deployed catalog on 2026-10-22.
with expected(schema_name,function_name,definition_md5) as (values
 ('private','set_organization_official_eligibility','b1260cf6e6b1fbb53135bfb8df37b87f'),
 ('public','review_self_assign_override','0582783ac55928d6b368b463ec5d0ce5'),
 ('public','self_assign_game_mentor','3ecc09cec96db2a58d92c3303c982876'),
 ('public','get_assignment_candidate_conflicts','c733c680cac2ac0fc681280994514b19'),
 ('public','assign_official_to_linked_games','580686d520854bb39f34c88c73f49b7c'),
 ('public','can_manage_game_setup','9950a99992e1e621305776504bcdb9cc'),
 ('private','get_or_create_league_connection_link_impl','71417dc567a23918fba82351cdbdd027'),
 ('public','can_access_game_report','246926d2672f631c011925623a060880'),
 ('public','move_assignment_position','1aa0907d00f61f6fef7d3f628934566d'),
 ('public','get_game_crew_chat','1d871aa09db3413d9e373b5e9664b6aa'),
 ('private','accept_my_organization_invitations_impl','8b59a585c2de7aa87e7cfb7c4891e014'),
 ('public','set_organization_official_position_eligibility','f0481c660b768c0b77a72741550f6a25'),
 ('private','can_manage_organization_league_settings','d102a69ab8b6035040bd1b7adbc6cbad'),
 ('public','resolve_overdue_assignments','c100cccc804f841b3d5ec23b4af817fb'),
 ('private','can_manage_organization','fb346b179cbca7e3aa66cd6a47bc33fb'),
 ('public','can_read_league_document','4a7a7116831ad38640b94312425e47be'),
 ('public','run_my_auto_assign','df172d3f5760d07beeecd5740fd6fa46'),
 ('private','get_organization_setup_directory_impl','ff7ffca176ae332608841ce30d2f0cbd'),
 ('private','get_organization_team_impl','886a893624370b9e1c10b5d501f88bc6'),
 ('public','get_organization_field_complexes','8ecddb22287eccc3f1d9e75a44313b4e'),
 ('public','set_organization_field_complex','ae268b66d8e8fb09e3e823e81385a435'),
 ('public','create_organization_invitation','a7fd3bbc121511c9e57a0ac2e027eaa0'),
 ('private','create_organization_invitation_impl','0c90197d5756a4ed968fe84b263ab413'),
 ('public','publish_game_assignments','a01ce5a7fc9bea110ed6647a46e8b0de'),
 ('public','move_official_between_fields','c7979b56a44c4a07bfb928a77066655e'),
 ('private','get_organization_locations_impl','b12a0b5911df0964708e984335e95078'),
 ('private','can_manage_organization_league','07037de5b480ce63b575031a10fbdd46'),
 ('private','can_read_organization_game','5ed0f8dd04cbc9515b561a14c3f30ea0'),
 ('private','is_organization_owner_or_admin','a2bd8cc16648bbb4d2c9a0c3886c580d'),
 ('private','can_access_organization_league','82f662c1f478e3f34e1dd7c488454b05'),
 ('public','can_manage_rank','9db22716ee77d923edcf2f9847e75e8c'),
 ('public','is_refassign_staff','fbdde957c5d524e33336a88ba0ee963b'),
 ('public','set_game_status','1030cb0a803ef0756e7fcbb8b1c9fde7'),
 ('private','can_manage_game','3d1e961c2c151ea437a7a93f5c5a2028'),
 ('public','apply_game_import','eef15aab72fdf19ff3fc94a1d2997546'),
 ('private','get_my_test_workspaces_impl','0efe5144fdcac95f0f28f392ffd354d2'),
 ('private','get_game_directory_impl','c8ec1a60af8e749ce092d2843f73d5ca'),
 ('private','can_rank_official','90e68cf5218ef1c269d042dccd051628'),
 ('private','can_rank_team','3cc6da5a5d20df8cf5200b71001cd7e3'),
 ('private','upsert_my_official_roster_row','75db73ffee9d87e38ca15b8ddb35f4d4'),
 ('public','set_organization_user_roles','e5a1fa1dde91b731d5c0a77a645a8c3f'),
 ('public','set_organization_invitation_roles','9fcea37ffcabee6afc2101a49feaf59e'),
 ('public','set_my_official_assessment','4be5774ff02ad6df91c1737b54597ed6'),
 ('public','confirm_calendar_game_review','edd281921820104e5aa7d0c303678128'),
 ('private','upsert_my_referee_profile_row','dae4e114e89b3bd6da9fdaa570beb59e'),
 ('private','sync_organization_user_roles','299d327539763c3c36a87d9539f97f48'),
 ('private','set_organization_invitation_roles_impl','92b4009a0d496a4ddbf83d93d9c1373c'),
 ('private','get_organization_official_directory_impl','f7468846eedcbc288cad20494eb2f91b'),
 ('public','review_and_release_bound_game','b891940aa6d715f69e93043308afe828'),
 ('private','save_organization_league_teams_impl','6551e2bf19d98c4bb86fc90ac6124fca'),
 ('private','save_organization_league_levels_impl','d864d2838a69fcd46f03bb32ed4afabe')
), actual as (
 select n.nspname schema_name,p.proname function_name,md5(pg_get_functiondef(p.oid)) definition_md5
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind='f' and exists(select 1 from expected e where e.schema_name=n.nspname and e.function_name=p.proname)
)
select coalesce(e.schema_name,a.schema_name) schema_name,coalesce(e.function_name,a.function_name) function_name,
 e.definition_md5 expected_md5,a.definition_md5 actual_md5
from expected e full join actual a using(schema_name,function_name,definition_md5)
where e.definition_md5 is null or a.definition_md5 is null;

-- Existing grants, including deliberate empty scopes, must not be expanded.
select count(*) grant_rows,count(distinct (organization_id,user_id,league_id)) distinct_grants
from public.organization_member_league_access;

-- The new columns should not already exist before this one-time migration.
select table_name,column_name from information_schema.columns
where table_schema='public' and ((table_name='organization_member_league_access' and column_name in ('all_locations','location_ids'))
 or (table_name='organization_invitations' and column_name='league_access'));
