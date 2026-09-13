-- API clients never need schema-management privileges. In particular,
-- TRUNCATE bypasses row-level security entirely, so it must not be available to
-- anon or authenticated users even when table CRUD is intentionally granted.
revoke truncate,references,trigger on all tables in schema public from anon,authenticated;

-- Keep future public tables safe when they are created by the migration owner.
alter default privileges in schema public
  revoke truncate,references,trigger on tables from anon,authenticated;
