-- LOCAL TEST STACK ONLY. Never run against a Supabase project: Supabase already
-- provides these roles and schemas. This recreates the minimum a real Supabase
-- database has, so the real Supabase Auth server, PostgREST, our migration and
-- our RLS policies can run unchanged on a throwaway PostgreSQL cluster.
create extension if not exists pgcrypto;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login password 'local-authenticator' noinherit;
grant anon, authenticated, service_role to authenticator;

create role supabase_auth_admin login password 'local-auth-admin' createrole;
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
grant create on database postgres to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
