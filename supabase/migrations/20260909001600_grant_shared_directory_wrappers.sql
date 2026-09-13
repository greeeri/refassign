-- The public security-invoker wrappers call these checked private functions.
-- The private schema is not exposed by the Data API, and each function verifies
-- the authenticated caller's organization access before reading or writing.
grant execute on function private.get_organization_setup_directory_impl(uuid) to authenticated,service_role;
grant execute on function private.search_shared_directory_impl(uuid,text,text) to authenticated,service_role;
grant execute on function private.connect_shared_directory_record_impl(uuid,text,uuid) to authenticated,service_role;
grant execute on function private.create_or_connect_organization_level_impl(uuid,text,integer) to authenticated,service_role;
grant execute on function private.create_or_connect_organization_team_impl(uuid,text,uuid,uuid) to authenticated,service_role;
grant execute on function private.disconnect_shared_directory_record_impl(uuid,text,uuid) to authenticated,service_role;
