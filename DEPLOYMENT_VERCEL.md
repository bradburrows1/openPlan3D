# Deploying Northway Floor Plans to Vercel

The app is a SvelteKit site, and almost all of it runs in the browser. Since Stage 3, staff sign in
with Supabase Auth and plans are saved to a Supabase database protected by Row Level Security; see
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md). The browser talks to Supabase directly with the public
(publishable) key; no server secrets are involved. On Vercel it deploys as static assets plus a few
small serverless functions for server-side rendering and the dormant upstream `/api/*` and `/mcp`
routes, which return HTTP 503 unless enabled.

## How the build is wired

* `svelte.config.js` uses `@sveltejs/adapter-vercel` when `VERCEL` is set, which Vercel always does
  during its builds. Everywhere else it uses the upstream `@sveltejs/adapter-node`, so
  `node build/index.js`, the Playwright tests and Firebase App Hosting are unchanged.
* `vercel.json` sets:
  * `installCommand`: `npm ci --include=dev`. The build tools are devDependencies, and they must be
    installed even if `NODE_ENV=production` is set.
  * `buildCommand`: `NODE_ENV=production npm run build`. `vite.config.ts` refuses non-production
    builds.
  * `framework`: `sveltekit`.
* Output goes to `.vercel/output/`, which is git-ignored.

Check locally before deploying:

```bash
npm ci
VERCEL=1 NODE_ENV=production npm run build   # produces .vercel/output
```

## Connect the repository to Vercel

1. Sign in at <https://vercel.com> with the account or team that should own the project, and connect
   GitHub if asked.
2. **Add New… → Project → Import Git Repository**. Choose `bradburrows1/openPlan3D`. If it is not
   listed, use "Adjust GitHub App Permissions" to give Vercel access to that repository.
3. Configure the project:
   * **Framework preset**: SvelteKit (detected automatically, and also set in `vercel.json`).
   * **Root directory**: `./`.
   * **Build, install and output settings**: leave them at their defaults, because `vercel.json`
     overrides them.
   * **Node.js version** (Settings → Build and Deployment): 22.x or 24.x. `.nvmrc` says 24.
   * **Environment variables** (Stage 3): add `PUBLIC_SUPABASE_URL` and
     `PUBLIC_SUPABASE_PUBLISHABLE_KEY` exactly as described in
     [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) section 6. Both are public by design. **Never** add a
     Supabase secret or service_role key. Leave `PUBLIC_ENABLE_ANALYTICS`, `HANDOFF_UPLOADS_ENABLED`
     and `ASSISTANT_SHARES_ENABLED` **unset**. That keeps upstream analytics and cloud sharing off.
4. Click **Deploy**. The first deployment gets a `*.vercel.app` URL. Open it, sign in as a staff
   account, create a plan, draw a few walls, save it, and try an export.
5. **Production branch**: Settings → Git → Production Branch. Until Stage 1 is merged, either set it to
   `northway-stage-1` or treat that branch's deployments as previews (every push gets a preview URL)
   and merge to `main` when you are happy.
6. Optional: Settings → Deployment Protection → Vercel Authentication restricts the site to members
   of your Vercel team while it is internal-only.

## Add `plans.northwaypreservation.co.uk` later

Nothing is configured yet. When you are ready:

1. In the Vercel project: **Settings → Domains → Add** and enter `plans.northwaypreservation.co.uk`.
2. Vercel shows the DNS record it needs. For a subdomain this is normally a **CNAME**:

   | Type | Name / Host | Value |
   |---|---|---|
   | CNAME | `plans` | the target Vercel shows, e.g. `cname.vercel-dns.com` or a project-specific `*.vercel-dns-0.com` value |

   Use the exact value shown in the Vercel dashboard. It can differ per project.
3. Add that record wherever DNS for `northwaypreservation.co.uk` is managed (domain registrar,
   Cloudflare, Microsoft 365/GoDaddy and so on). Do **not** change the apex or `www` records, and do not
   change the nameservers. Only the `plans` subdomain is added, so the main website and email are
   unaffected.
   * If DNS is on Cloudflare, set the record to **DNS only** (grey cloud) so Vercel can issue the
     certificate.
   * If Vercel asks for a `TXT` verification record (for example because the domain is already used in
     another Vercel account), add that as well.
4. Wait for the domain to show **Valid Configuration**. This usually takes minutes, and up to the DNS
   TTL. Vercel then issues the HTTPS certificate automatically.
5. Optional: set it as the primary domain and redirect the `*.vercel.app` URL to it.
6. In Supabase, **Authentication → URL Configuration**: set **Site URL** to
   `https://plans.northwaypreservation.co.uk` and keep it in **Redirect URLs**.

Plans saved to Northway Plans live in Supabase, so they appear on the new domain straight away after
signing in again. Only per-browser items stay on the old address: the sign-in session, unsaved-change
recovery copies, view settings and any projects in the legacy local library (`/local`).
