# Northway Plans: security checklist (Stage 7)

What was verified for Northway Plans v1, and how. "Automated" means a test checks it on every run:
`tests/northway-cloud.test.ts` runs against a real Supabase Auth, PostgREST and PostgreSQL stack;
the browser tests run against the production build.

| # | Check | Result | How it was verified |
|---|---|---|---|
| 1 | Signed-out visitors cannot read or write plans | ✅ | Automated: the anonymous key alone gets "permission denied" or no rows for select, insert, update and delete (`northway-cloud.test.ts`). In the browser, `/`, `/projects/<id>`, `/editor` and `/local` redirect to `/login` (`northway-plans.spec.ts`). |
| 2 | Signed-in accounts that are not on the staff list see nothing | ✅ | Automated: an account outside `northway_plan_staff` gets no rows and cannot insert, update or delete. Create attempts are refused by RLS and shown as a plain "Could not create this plan" message. |
| 3 | RLS is enabled on every Northway table | ✅ | `supabase/migrations/20261009120000_northway_floor_plan_projects.sql` enables RLS on `floor_plan_projects` and `northway_plan_staff`, and policies allow staff only. The integration tests use the same migration. |
| 4 | Public sign-up is disabled | ✅ | Automated: sign-up with the publishable key is refused (`signup_disabled`). The app has no registration page; `/login` is the only public page. SUPABASE_SETUP.md section 2 explains how to keep it off in production. |
| 5 | No service-role or secret key in the client | ✅ | `src/` contains no `service_role`, `sb_secret` or JWT secret. The only match in the built client is supabase-js's own check of key prefixes, not a key. The app reads only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the legacy anon key). |
| 6 | No secrets committed to Git | ✅ | Only `.env.example` (placeholders) is tracked, and no `.env` file appears anywhere in the history. `.gitignore` excludes `.env` and `.env.*`. Docs use placeholders such as `<project-ref>`. |
| 7 | Project URLs carry no customer data | ✅ | Routes are `/projects/<uuid>`; the page refuses anything that is not a UUID. Names and addresses never appear in URLs. After an expired session, the login page's return link accepts only `/projects/<uuid>`, never another site. |
| 8 | Project and customer data not logged | ✅ | Northway code has no `console.log`. Failures log only an error's name, code and first 300 characters of message (`cloud/errors.ts`), never plan, customer or address data. Analytics are off unless `PUBLIC_ENABLE_ANALYTICS=true`. |
| 9 | Server bookkeeping cannot be forged | ✅ | Automated: `created_by`, `updated_by`, timestamps and `revision` are set by a database trigger. A stale save is refused (optimistic concurrency). |
| 10 | Imports are validated | ✅ | Every import passes `readProject()` validation (types, ranges, colours, references) or the RoomPlan importer, with a 64 MB limit. Malformed files are refused with one plain message and never reach the editor (automated). Text is rendered with Svelte (escaped) or drawn on canvas; SVG export escapes text (`escapeXml`). |
| 11 | Sessions | ✅ | The session persists in this browser until Sign out, which is local to that device. A session ending elsewhere keeps unsaved edits on the device, explains itself and returns to the same plan after sign-in (automated). |
| 12 | Dependencies | ✅ | `npm audit --omit=dev` reports **0 vulnerabilities** after the patch-level `dompurify` 3.4.16 update (a jsPDF dependency). No major upgrades were made. |
| 13 | HTTP security headers (Vercel) | ✅ | `vercel.json` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera, microphone, location and payment off) and HSTS. |
| 14 | Upstream cloud features | ✅ | iPhone handoff uploads, assistant sharing and `/mcp` return 503 unless explicitly enabled. Leave their environment variables unset. |

## Not done (accepted for v1)

* **Content-Security-Policy.** Not set, because SvelteKit's inline start-up script needs a nonce or
  hash setup. With no third-party scripts loaded and analytics off, the risk is low. Consider it
  later with SvelteKit's `csp` option.
* **Preview deployments.** If Vercel previews get the same environment variables, they reach the same
  database. Protect them with Vercel Authentication, or give previews a separate Supabase project
  (DEPLOYMENT.md).
* **Password reset.** There is no self-service reset; an administrator sets passwords in Supabase.
  Use strong, unique passwords for both staff accounts.
* **Recovery copies.** Unsaved edits are kept in each device's browser storage (IndexedDB) until
  saved or discarded. Signing out does not wipe them, by design, so work is never lost. On a shared
  device, open the plan and choose Discard.
