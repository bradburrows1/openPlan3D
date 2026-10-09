-- Northway Plans: private floor-plan project library.
--
-- Each row stores one complete, editable OpenPlan3D/Northway project document
-- (the same JSON as "Download JSON"), plus the few fields the library lists and
-- searches. Walls, rooms, fixtures and Survey Finding zones are NOT normalised
-- into tables: the project document is the source of truth, and schema_version
-- lets future releases migrate older documents instead of refusing them.
--
-- Access model (Stage 3): every signed-in account listed in northway_plan_staff
-- may read and write every project. Nobody else, including the anon role and
-- signed-in accounts that are not on the staff list, has any access.

-- ── Staff allowlist ────────────────────────────────────────────────────
-- Public sign-up should be disabled in Supabase Auth. This list is the second
-- lock: an account that somehow exists but was never added here still sees
-- nothing. Add staff with the SQL in SUPABASE_SETUP.md.
create table if not exists public.northway_plan_staff (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  added_at    timestamptz not null default now(),
  note        text
);

alter table public.northway_plan_staff enable row level security;
revoke all on public.northway_plan_staff from anon, authenticated;
-- Signed-in users may only see whether they themselves are staff.
grant select on public.northway_plan_staff to authenticated;
drop policy if exists "staff can see own membership" on public.northway_plan_staff;
create policy "staff can see own membership" on public.northway_plan_staff
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_northway_plan_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.northway_plan_staff where user_id = auth.uid());
$$;
revoke all on function public.is_northway_plan_staff() from public, anon;
grant execute on function public.is_northway_plan_staff() to authenticated;

-- ── Projects ───────────────────────────────────────────────────────────
create table if not exists public.floor_plan_projects (
  id                     uuid primary key default gen_random_uuid(),
  project_name           text not null
                           check (length(btrim(project_name)) between 1 and 200),
  customer_name          text check (customer_name is null or length(customer_name) <= 200),
  property_address       text check (property_address is null or length(property_address) <= 500),
  -- The complete editable project document.
  project_data           jsonb not null check (jsonb_typeof(project_data) = 'object'),
  -- Version of the project_data format. 1 = OpenPlan3D web project v1 + Northway fields.
  schema_version         integer not null default 1 check (schema_version >= 1),
  -- Incremented whenever project_data changes; the editor saves only if the
  -- plan was not saved elsewhere in between. Renames do not change it.
  revision               integer not null default 1,
  -- The document as it was before the latest save, kept for manual recovery.
  previous_project_data  jsonb,
  created_by             uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by             uuid references auth.users (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists floor_plan_projects_updated_at_idx
  on public.floor_plan_projects (updated_at desc);

-- Server-owned bookkeeping: clients cannot forge authorship, timestamps or revisions.
create or replace function public.floor_plan_projects_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.revision := 1;
    new.previous_project_data := null;
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
    if new.project_data is distinct from old.project_data then
      new.revision := old.revision + 1;
      new.previous_project_data := old.project_data;
    else
      new.revision := old.revision;
      new.previous_project_data := old.previous_project_data;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists floor_plan_projects_before_write on public.floor_plan_projects;
create trigger floor_plan_projects_before_write
  before insert or update on public.floor_plan_projects
  for each row execute function public.floor_plan_projects_before_write();

alter table public.floor_plan_projects enable row level security;
revoke all on public.floor_plan_projects from anon, authenticated;
grant select, insert, update, delete on public.floor_plan_projects to authenticated;

drop policy if exists "staff read projects" on public.floor_plan_projects;
create policy "staff read projects" on public.floor_plan_projects
  for select to authenticated using (public.is_northway_plan_staff());

drop policy if exists "staff create projects" on public.floor_plan_projects;
create policy "staff create projects" on public.floor_plan_projects
  for insert to authenticated with check (public.is_northway_plan_staff());

drop policy if exists "staff update projects" on public.floor_plan_projects;
create policy "staff update projects" on public.floor_plan_projects
  for update to authenticated
  using (public.is_northway_plan_staff())
  with check (public.is_northway_plan_staff());

drop policy if exists "staff delete projects" on public.floor_plan_projects;
create policy "staff delete projects" on public.floor_plan_projects
  for delete to authenticated using (public.is_northway_plan_staff());
