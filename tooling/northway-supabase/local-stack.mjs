#!/usr/bin/env node
// @ts-nocheck -- plain Node tooling script, not part of the app bundle
/**
 * LOCAL TEST STACK ONLY: a throwaway, Supabase-compatible backend for tests and
 * local development of Northway Plans. Never point it at real data.
 *
 * It runs the real components Supabase runs, on a temporary PostgreSQL cluster:
 *   - Supabase Auth (GoTrue) with public sign-up DISABLED,
 *   - PostgREST, which enforces the migration's Row Level Security,
 *   - a small gateway on one port that, like Supabase's API gateway, routes
 *     /auth/v1 and /rest/v1 and rejects requests without a valid API key.
 * Then it applies supabase/migrations/*.sql and creates test accounts.
 *
 * Binaries are not committed. Fetch them with tooling/northway-supabase/fetch-binaries.sh
 * (or set NORTHWAY_GOTRUE_BIN, NORTHWAY_GOTRUE_MIGRATIONS and NORTHWAY_POSTGREST_BIN).
 *
 *   node tooling/northway-supabase/local-stack.mjs      # run until Ctrl+C
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, chownSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const localDir = join(root, '.northway-local');

export const LOCAL_STAFF = [
  { email: 'brad@northway.test', password: 'Northway-local-1' },
  { email: 'lewis@northway.test', password: 'Northway-local-2' },
];
/** Signed in, but deliberately NOT on the staff list: must see nothing. */
export const LOCAL_OUTSIDER = { email: 'outsider@example.test', password: 'Outsider-local-1' };

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}
export function signJwt(payload, secret) {
  const head = base64url({ alg: 'HS256', typ: 'JWT' }), body = base64url(payload);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

/** The project's public API key for a stack secret (deterministic, so test servers can be configured up front). */
export function localAnonKey(secret) {
  return signJwt({ role: 'anon', iss: 'northway-local', iat: 1_700_000_000, exp: 4_102_444_800 }, secret);
}

function pgBin() {
  if (process.env.NORTHWAY_PG_BIN) return process.env.NORTHWAY_PG_BIN;
  for (const version of ['17', '16', '15', '14']) {
    const dir = `/usr/lib/postgresql/${version}/bin`;
    if (existsSync(join(dir, 'initdb'))) return dir;
  }
  return execFileSync('pg_config', ['--bindir']).toString().trim();
}

/** PostgreSQL refuses to run as root; run its tools as the postgres user when needed. */
function asPostgres(command, args, options = {}) {
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  return root ? ['runuser', ['-u', 'postgres', '--', command, ...args], options] : [command, args, options];
}

function run(command, args, options = {}) {
  execFileSync(...asPostgres(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options }));
}

async function waitFor(url, label, timeout = 30_000, ok = response => response.status < 500) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { if (ok(await fetch(url))) return; } catch (error) { last = error; }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`${label} did not start (${last?.message ?? 'timeout'})`);
}

function startProcess(command, args, env, logFile) {
  const child = spawn(command, args, { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  const keep = chunk => { log.push(chunk.toString()); if (log.length > 200) log.shift(); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  child.on('exit', () => { if (logFile) try { writeFileSync(logFile, log.join('')); } catch {} });
  child.recentLog = () => log.join('').slice(-4000);
  return child;
}

function gateway({ port, authPort, restPort, keys }) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, range, x-supabase-api-version',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range, content-location, x-total-count',
  };
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = new URL(req.url, 'http://gateway');
    const target = url.pathname.startsWith('/auth/v1/') ? { port: authPort, path: url.pathname.slice(8) }
      : url.pathname.startsWith('/rest/v1/') ? { port: restPort, path: url.pathname.slice(8) } : null;
    const apikey = req.headers.apikey ?? url.searchParams.get('apikey');
    if (!target) { res.writeHead(404, cors); res.end('{"message":"no route"}'); return; }
    // Like Supabase's gateway: no valid project API key, no access at all.
    if (!keys.includes(apikey)) { res.writeHead(401, { ...cors, 'content-type': 'application/json' }); res.end('{"message":"Invalid API key"}'); return; }
    const headers = { ...req.headers };
    // Requests without a user session act with the role carried by the API key.
    if (!headers.authorization) headers.authorization = `Bearer ${apikey}`;
    delete headers.host;
    const upstream = httpRequest({ host: '127.0.0.1', port: target.port, method: req.method, path: target.path + url.search, headers }, upstreamRes => {
      res.writeHead(upstreamRes.statusCode ?? 502, { ...upstreamRes.headers, ...cors });
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, cors); res.end(); });
    req.pipe(upstream);
  });
  return new Promise(resolveServer => server.listen(port, '127.0.0.1', () => resolveServer(server)));
}

/**
 * Start everything; resolves once accounts exist. Call stop() to tear down.
 * @param {{ port?: number, quiet?: boolean, jwtSecret?: string }} [options]
 */
export async function startLocalStack({ port = 54321, quiet = true, jwtSecret: fixedSecret } = {}) {
  const gotrueBin = process.env.NORTHWAY_GOTRUE_BIN ?? join(localDir, 'auth', 'auth');
  const gotrueMigrations = process.env.NORTHWAY_GOTRUE_MIGRATIONS ?? join(localDir, 'auth', 'migrations');
  const postgrestBin = process.env.NORTHWAY_POSTGREST_BIN ?? join(localDir, 'postgrest');
  for (const [label, path] of [['Supabase Auth', gotrueBin], ['Supabase Auth migrations', gotrueMigrations], ['PostgREST', postgrestBin]]) {
    if (!existsSync(path)) throw new Error(`${label} not found at ${path}. Run tooling/northway-supabase/fetch-binaries.sh first.`);
  }
  const pgPort = port + 1, authPort = port + 2, restPort = port + 3;
  const jwtSecret = fixedSecret ?? randomBytes(32).toString('hex');
  const anonKey = localAnonKey(jwtSecret);
  const now = Math.floor(Date.now() / 1000);
  const serviceKey = signJwt({ role: 'service_role', iss: 'northway-local', iat: now, exp: now + 86_400 }, jwtSecret);

  const dataDir = mkdtempSync(join(tmpdir(), 'northway-supabase-'));
  const bin = pgBin();
  if (process.getuid?.() === 0) chownSync(dataDir, Number(execFileSync('id', ['-u', 'postgres']).toString()), Number(execFileSync('id', ['-g', 'postgres']).toString()));
  const children = [];
  let pgStarted = false;
  const stop = async () => {
    for (const child of children.reverse()) child.kill('SIGTERM');
    await Promise.all(children.map(child => new Promise(r => child.exitCode !== null ? r() : child.once('exit', r))));
    if (pgStarted) try { run(join(bin, 'pg_ctl'), ['-D', join(dataDir, 'pg'), '-m', 'fast', 'stop']); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    run(join(bin, 'initdb'), ['-D', join(dataDir, 'pg'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
    run(join(bin, 'pg_ctl'), ['-D', join(dataDir, 'pg'), '-l', join(dataDir, 'pg.log'), '-w', '-o', `-p ${pgPort} -k ${dataDir} -c listen_addresses=127.0.0.1`, 'start']);
    pgStarted = true;
    const psql = (sql, file) => run(join(bin, 'psql'), ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', ...(file ? ['-f', file] : ['-c', sql])]);
    psql(null, join(here, 'bootstrap.sql'));

    const db = (user, password) => `postgres://${user}:${password}@127.0.0.1:${pgPort}/postgres`;
    const site = process.env.NORTHWAY_SITE_URL ?? 'http://127.0.0.1:4188';
    const auth = startProcess(gotrueBin, [], {
      GOTRUE_DB_DRIVER: 'postgres', DATABASE_URL: `${db('supabase_auth_admin', 'local-auth-admin')}?search_path=auth`,
      GOTRUE_DB_MIGRATIONS_PATH: gotrueMigrations, GOTRUE_API_HOST: '127.0.0.1', PORT: String(authPort),
      API_EXTERNAL_URL: `http://127.0.0.1:${port}/auth/v1`, GOTRUE_SITE_URL: site,
      GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_EXP: '7200', GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      // The same settings SUPABASE_SETUP.md asks for: no public sign-up, email + password only.
      GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
      GOTRUE_LOG_LEVEL: 'warn',
    }, join(dataDir, 'auth.log'));
    children.push(auth);
    await waitFor(`http://127.0.0.1:${authPort}/health`, 'Supabase Auth', 60_000, r => r.ok).catch(error => { throw new Error(`${error.message}\n${auth.recentLog()}`); });

    for (const file of readdirSync(join(root, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
      psql(null, join(root, 'supabase', 'migrations', file));
    }

    const rest = startProcess(postgrestBin, [], {
      PGRST_DB_URI: db('authenticator', 'local-authenticator'), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: jwtSecret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(restPort), PGRST_LOG_LEVEL: 'warn',
    }, join(dataDir, 'rest.log'));
    children.push(rest);
    await waitFor(`http://127.0.0.1:${restPort}/`, 'PostgREST').catch(error => { throw new Error(`${error.message}\n${rest.recentLog()}`); });

    const server = await gateway({ port, authPort, restPort, keys: [anonKey, serviceKey] });
    children.push({ kill: () => server.close(), once: (_e, r) => server.once('close', r), exitCode: null });

    const url = `http://127.0.0.1:${port}`;
    const users = {};
    for (const account of [...LOCAL_STAFF, LOCAL_OUTSIDER]) {
      const response = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST', headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: account.password, email_confirm: true }),
      });
      if (!response.ok) throw new Error(`Could not create ${account.email}: ${response.status} ${await response.text()}`);
      users[account.email] = (await response.json()).id;
    }
    // Exactly what SUPABASE_SETUP.md tells you to run for Brad and Lewis.
    psql(`insert into public.northway_plan_staff (user_id) select id from auth.users where email in (${LOCAL_STAFF.map(s => `'${s.email}'`).join(', ')});`);

    if (!quiet) console.log(`Northway local Supabase stack ready at ${url}`);
    return { url, anonKey, serviceKey, jwtSecret, users, psql, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stack = await startLocalStack({ quiet: false, port: Number(process.env.NORTHWAY_SUPABASE_PORT ?? 54321) });
  console.log(JSON.stringify({ PUBLIC_SUPABASE_URL: stack.url, PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.anonKey, staff: LOCAL_STAFF, outsider: LOCAL_OUTSIDER }, null, 2));
  if (process.env.NORTHWAY_STACK_ENV_FILE) writeFileSync(process.env.NORTHWAY_STACK_ENV_FILE, `PUBLIC_SUPABASE_URL=${stack.url}\nPUBLIC_SUPABASE_PUBLISHABLE_KEY=${stack.anonKey}\n`);
  const shutdown = async () => { await stack.stop(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
