# Northway Plans: Supabase setup

Northway Plans uses Supabase for three things only: staff sign-in (email and password), the list of
plans, and the saved, editable plan documents. Everything else still runs in the browser. Follow these
steps once. They take about 15 minutes.

No real credentials belong in this repository. Placeholders look like `<this>`.

## 1. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard> and choose **New project**.
2. Pick your organisation, name the project (for example `northway-plans`), choose a **UK or EU
   region** (for example London `eu-west-2`), and set a strong database password. Store the password in
   your password manager; the app never needs it.
3. Use a **separate project from Northway OS**. Stage 3 deliberately does not integrate the two.
4. Wait for the project to finish provisioning.

## 2. Configure Authentication: staff only, no public sign-up

In **Authentication**:

1. **Sign In / Providers** (named *Providers* in some dashboard versions):
   * **Email**: enabled. Email + password is the only method the app uses.
   * Turn **off** every other provider (Google, Apple, phone, …) and **Anonymous sign-ins**.
2. **Allow new users to sign up**: **OFF**. This is the most important setting. With sign-up off,
   accounts can only be created by an administrator.
3. **URL Configuration → Site URL**: `https://plans.northwaypreservation.co.uk`. Until the domain is
   live, use your `https://<your-project>.vercel.app` address. Add both under **Redirect URLs**.
4. Optional: under **Sessions** you can time-box sessions (for example 30 days) or require
   re-authentication after inactivity. By default a signed-in browser stays signed in until **Sign out**.

## 3. Run the database migration

The schema is in
[`supabase/migrations/20261009120000_northway_floor_plan_projects.sql`](supabase/migrations/20261009120000_northway_floor_plan_projects.sql).
It creates:

| Object | Purpose |
|---|---|
| `public.northway_plan_staff` | The staff allowlist: Supabase user ids allowed to use the app. |
| `public.is_northway_plan_staff()` | Helper used by the security policies. |
| `public.floor_plan_projects` | One row per plan. Details in "What is stored" below. |
| Trigger `floor_plan_projects_before_write` | Sets `created_by`, `updated_by`, the timestamps and `revision`, and keeps the previous plan document on every save. |
| RLS policies | Staff may read, create, update and delete every plan. Everyone else gets nothing. |

Run it in **one** of these ways:

* **Dashboard (simplest)**: open **SQL Editor → New query**, paste the whole file, and press **Run**.
  You should see "Success. No rows returned".
* **Supabase CLI**: `supabase link --project-ref <project-ref>` then `supabase db push`.

The migration is safe to run more than once.

Then check **Project Settings → Data API**:

* The Data API is enabled.
* `public` is in **Exposed schemas**.

## 4. Create the staff accounts (Brad and Lewis)

For each person:

1. **Authentication → Users → Add user → Create new user**.
2. Enter their email and a strong temporary password, and tick **Auto Confirm User**. Do not send an
   invite: the app has no invite or magic-link page yet.
3. Give them the password through a secure channel. They sign in at `/login`.

Then add them to the staff allowlist. In **SQL Editor**, run (with the real emails):

```sql
insert into public.northway_plan_staff (user_id, note)
select id, email from auth.users
where email in ('<brad@northwaypreservation.co.uk>', '<lewis@northwaypreservation.co.uk>')
on conflict (user_id) do nothing;

-- Check: should list exactly your staff
select u.email, s.added_at from public.northway_plan_staff s join auth.users u on u.id = s.user_id;
```

* An account that exists but is **not** on this list can sign in to Supabase, but the app shows "not
  authorised" and the database returns no plans. This is the safety net if sign-up is ever switched
  back on by mistake.
* To remove someone: `delete from public.northway_plan_staff where user_id = (select id from auth.users where email = '<email>');`.
  Then delete or ban the user in **Authentication → Users**.
* Password changes: there is no reset page in the app yet. An administrator can set a new password
  for a user in **Authentication → Users** (the user's menu, depending on dashboard version).
  Alternatively, delete the user, re-create them, and re-run the insert above. Plans are not affected.

## 5. Keys: what is safe and what is secret

In **Project Settings → API Keys**:

| Value | Where it goes | Safe in the browser? |
|---|---|---|
| Project URL `https://<project-ref>.supabase.co` | Vercel `PUBLIC_SUPABASE_URL` | **Yes**. It is public by design. |
| **Publishable key** `sb_publishable_…` (or the legacy **anon** key `eyJ…`) | Vercel `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Yes**. It only grants what RLS allows; without a staff sign-in that is nothing. |
| **Secret key** `sb_secret_…` / legacy **service_role** key | **Nowhere in this app** | **NO**. It bypasses RLS. Never put it in Vercel, `.env`, the repository, chat or email. |
| Database password / connection strings | **Nowhere in this app** | **NO**. Only for administrators using the dashboard or CLI. |
| JWT secret | **Nowhere in this app** | **NO**. |

The app reads only the two `PUBLIC_…` variables. Nothing in it needs, or would use, a secret key.

## 6. Vercel environment variables

In Vercel, open **Project → Settings → Environment Variables** and add:

| Name | Value | Environments |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Production (and Preview, see note) |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_<…>` | Production (and Preview, see note) |

Then **redeploy**: Deployments → … → Redeploy. Environment changes apply to new deployments only.

* Leave `PUBLIC_ENABLE_ANALYTICS`, `HANDOFF_UPLOADS_ENABLED` and `ASSISTANT_SHARES_ENABLED` **unset**.
* **Preview deployments use the same database** if you give them these variables. Protect previews
  with Vercel Authentication (Settings → Deployment Protection), or give Preview a separate Supabase
  project.
* If the variables are missing, the app fails closed: the login page says sign-in is not configured,
  and nothing can be read.

For local development, copy [`.env.example`](.env.example) to `.env` (git-ignored) and fill in the same
two values.

## 7. Verify that RLS is protecting the plans

Run these after the first deployment. Replace the placeholders.

**a. Signed out, the API returns nothing.** In a terminal:

```bash
curl -s "https://<project-ref>.supabase.co/rest/v1/floor_plan_projects?select=id,project_name" \
  -H "apikey: <publishable key>"
```

Expected: an error such as `{"code":"42501","message":"permission denied for table floor_plan_projects"}`.
The other acceptable result is `[]`. **Never** a list of plans.

**b. No key at all is rejected**: the same command without `-H "apikey: …"` returns `401`.

**c. Public sign-up is refused:**

```bash
curl -s "https://<project-ref>.supabase.co/auth/v1/signup" -H "apikey: <publishable key>" \
  -H "content-type: application/json" -d '{"email":"test@example.com","password":"Test-password-1"}'
```

Expected: an error saying signups are not allowed (`signup_disabled`).

**d. Staff access works.** Sign in at `/login` as Brad, create a plan called `RLS check`, and confirm Lewis
can see it too.

**e. Non-staff accounts see nothing (optional).**
1. Create a throwaway user in **Authentication → Users** and do *not* add them to `northway_plan_staff`.
2. Sign in as them. The app should say the account is not authorised.
3. Delete the user afterwards.

**f. Policies are in place.**
* **Authentication → Policies** (or **Database → Policies**) shows four policies on `floor_plan_projects`
  (read, create, update, delete, all for `authenticated` staff) and one on `northway_plan_staff`.
* RLS is **enabled** on both tables.
* **Advisors → Security Advisor** should report no errors for these tables.

The same checks run automatically against a local copy of Supabase Auth, PostgREST and PostgreSQL in
`tests/northway-cloud.test.ts` and `tests/browser/northway-plans.spec.ts` (see "Local testing" below).

## What is stored

`floor_plan_projects` columns:

| Column | Meaning |
|---|---|
| `id` | UUID. Used in the URL `/projects/<id>`; names and addresses never appear in URLs. |
| `project_name` | Required, up to 200 characters. |
| `customer_name`, `property_address` | Optional; searchable in the library. |
| `project_data` | The **complete editable plan**: the same JSON as "Download JSON". It includes floors, walls, rooms, doors, windows, fixtures, dimensions, labels, Survey Findings and Recommended Works zones (including custom ones), images and retained iPhone package data. |
| `schema_version` | Format of `project_data` (currently 1; Stage 4's Recommended Works fields are optional additions, so they need no new version). Newer formats are refused instead of damaged; older ones are upgraded on open. |
| `revision` | Increases on every plan save. A save only succeeds if nobody else saved since it was opened. Renames don't change it. |
| `previous_project_data` | The plan as it was before the latest save, for manual recovery. |
| `created_by`, `updated_by`, `created_at`, `updated_at` | Set by the database, not the browser. |

To recover the previous version of a plan manually (administrators, SQL Editor):

```sql
update public.floor_plan_projects
set project_data = previous_project_data
where id = '<plan id from the URL>' and previous_project_data is not null;
```

Backups: Supabase's daily backups cover this table. Staff can also use **Export → Download JSON** for
a portable copy of any plan.

## Local testing (developers)

`tooling/northway-supabase/` runs a throwaway, Supabase-compatible stack:
* the real Supabase Auth server with sign-up disabled;
* PostgREST;
* a temporary PostgreSQL;
* this migration and test accounts.

It never touches your Supabase project.

```bash
bash tooling/northway-supabase/fetch-binaries.sh   # once: downloads Supabase Auth + PostgREST (Linux x86-64)
NORTHWAY_STACK_ENV_FILE=.env node tooling/northway-supabase/local-stack.mjs   # leave running
npm run dev                                         # sign in as brad@northway.test / Northway-local-1
npm test                                            # includes the RLS integration tests
npx playwright test                                 # starts its own stack automatically
```

PostgreSQL 14–17 must be installed locally; the script only uses its command-line tools.
