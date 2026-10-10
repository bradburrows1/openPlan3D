# Deploying Northway Plans

This guide is for Brad, step by step. It takes about an hour the first time. You need:

* the GitHub account that owns `bradburrows1/openPlan3D`;
* a Vercel account (the free Hobby plan is enough to start);
* a Supabase account;
* access to the DNS for `northwaypreservation.co.uk`.

Placeholders look like `<this>`. Never paste real keys or passwords into this repository, a chat or an
email.

More detail, if needed: [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) (database and sign-in) and
[`DEPLOYMENT_VERCEL.md`](DEPLOYMENT_VERCEL.md) (build internals).

---

## Part A: Supabase (database and sign-in)

### 1. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**.
2. Name it `northway-plans` and choose a **UK or EU region** (for example London). Set a strong database
   password and keep it in your password manager; the app never needs it.

### 2. Turn off public sign-up

In **Authentication**:

* Email provider: **on**. All other providers: **off**.
* **Allow new users to sign up: OFF**. This matters most: only you can create accounts.

### 3. Run the database migration

1. Open **SQL Editor → New query**.
2. Paste the whole file `supabase/migrations/20261009120000_northway_floor_plan_projects.sql` from
   the repository, then press **Run**. You should see "Success". It is safe to run again.

### 4. Create the staff accounts (Brad and Lewis)

1. **Authentication → Users → Add user → Create new user.** Enter the email and a strong password, and
   tick **Auto Confirm User**.
2. Allow both people to use the app. In **SQL Editor**, run this with the real emails:

   ```sql
   insert into public.northway_plan_staff (user_id, note)
   select id, email from auth.users
   where email in ('<brad@…>', '<lewis@…>')
   on conflict (user_id) do nothing;
   ```

An account that is not on this list can sign in but sees "not authorised" and no plans.

### 5. Find the two values the app needs

**Project Settings → API Keys** (or Data API):

| Value | Name in Vercel | Safe to share? |
|---|---|---|
| Project URL `https://<project-ref>.supabase.co` | `PUBLIC_SUPABASE_URL` | Yes, it is public by design |
| Publishable key `sb_publishable_…` (or legacy "anon" key) | `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes. It only allows what the security rules allow, which is nothing until a staff member signs in |
| **Secret / service_role key**, database password, JWT secret | **Do not use anywhere in the app** | **No, keep these secret** |

---

## Part B: Vercel (the website)

### 6. Connect GitHub to Vercel

1. <https://vercel.com> → **Add New… → Project → Import Git Repository** → choose
   `bradburrows1/openPlan3D`. If it is missing, use "Adjust GitHub App Permissions".
2. Settings, all detected automatically:
   * Framework: **SvelteKit**
   * Root directory: `./`
   * Leave Build/Install/Output as they are (`vercel.json` sets them)
   * Node.js version: **22.x** or **24.x** (Settings → Build and Deployment)

### 7. Add the environment variables

**Settings → Environment Variables**, for **Production** (and Preview only if previews are protected,
see step 10):

| Name | Value |
|---|---|
| `PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_<…>` |

Leave these **unset**: `PUBLIC_ENABLE_ANALYTICS`, `HANDOFF_UPLOADS_ENABLED`,
`ASSISTANT_SHARES_ENABLED`. Never add a Supabase secret or service_role key.

### 8. Choose the production branch

**Settings → Git → Production Branch.** Set it to the branch Northway will use, for example `main` after
merging `northway-stage-7`, or `northway-stage-7` itself for the first trial.

### 9. Deploy to the temporary address

Click **Deploy** (or push to the production branch). You get an address like
`https://<project>.vercel.app`.

Then, in Supabase **Authentication → URL Configuration**:

* **Site URL:** `https://<project>.vercel.app` for now.
* **Redirect URLs:** add `https://<project>.vercel.app/**`.

### 10. Protect preview deployments (recommended)

Every branch push creates a preview address. Either:

* keep preview environment variables empty, so previews cannot reach the database; or
* turn on **Settings → Deployment Protection → Vercel Authentication**.

### 11. Test the deployment

On the `.vercel.app` address:

1. Signed out, the address goes to the sign-in page.
2. Sign in as Brad. The plan library appears.
3. **New Plan → Blank Plan**, draw a room, add a finding and a recommendation (choose a priority),
   then **Save**. It says "Saved".
4. Back to Plans, then reopen: everything is there.
5. **Export → Survey Plan**: download the Survey Findings Plan and the Recommended Works Plan. Insert
   them into a Word document.
6. **Sign out**, then sign in as Lewis: Lewis can see the same plan.
7. On the iPad, test Add to Home Screen (see the user guide).

---

## Part C: The final address `plans.northwaypreservation.co.uk`

### 12. Add the domain in Vercel

**Settings → Domains → Add** → `plans.northwaypreservation.co.uk`.

### 13. Add the DNS record

At your DNS provider for `northwaypreservation.co.uk`, add the record Vercel shows. For a subdomain it
is normally:

| Type | Name / Host | Value / Target |
|---|---|---|
| CNAME | `plans` | `cname.vercel-dns.com` (use exactly what Vercel shows) |

DNS changes can take from a few minutes to a few hours. Vercel then issues the HTTPS certificate
automatically. Do not change the main website's records.

### 14. Update Supabase for the final address

In Supabase **Authentication → URL Configuration**:

* **Site URL:** `https://plans.northwaypreservation.co.uk`
* **Redirect URLs:** add `https://plans.northwaypreservation.co.uk/**`. You can keep the `.vercel.app`
  entry while testing.

### 15. Verify the final domain

1. Open `https://plans.northwaypreservation.co.uk`. It shows the padlock and the sign-in page.
2. Sign in, open a plan, save, export: repeat step 11 briefly.
3. On each iPad, delete any old home-screen icon and add it again from the final address, then sign in
   once inside the home-screen app.

## Replacing the logo or the app icon later

* Export logo: `static/northway-logo.svg` (the approved file; keep the name).
* App icon (home screen): `static/icons/`, with `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png` (artwork inside the central 80%), `apple-touch-icon.png` (180 × 180) and
  `northway-plans-icon.svg`. The current icon is the emblem from the approved logo on white. Replace
  these files with approved artwork when available; the names must stay the same.

## If something goes wrong

* **"Sign-in is not configured"**: the two environment variables are missing or misspelt. Fix them,
  then **Redeploy**.
* **Sign-in works but "not authorised"**: add the account to `northway_plan_staff` (step 4).
* **A save fails**: the editor keeps the changes on the device and says so. Check the connection,
  then press Save again.
