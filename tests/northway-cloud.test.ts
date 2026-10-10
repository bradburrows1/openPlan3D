/**
 * Northway Plans against a real Supabase-compatible stack (Supabase Auth, PostgREST,
 * PostgreSQL + our migration and RLS). Skipped when the local stack binaries are not
 * installed: run tooling/northway-supabase/fetch-binaries.sh to enable it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startLocalStack, LOCAL_STAFF, LOCAL_OUTSIDER } from '../tooling/northway-supabase/local-stack.mjs';
import { createDefaultProject } from '$lib/stores/project';
import { createProjectFromRoomPlan } from '$lib/utils/roomplanImport';
import { readFileSync } from 'node:fs';
import { createProject, deleteProject, duplicateProject, getProject, listProjects, saveProject, updateMetadata, ProjectConflictError, ProjectMissingError } from '$lib/northway/cloud/projectsApi';
import { documentToProject } from '$lib/northway/cloud/projectDocument';
import { rectangleWalls } from './fixtures/project';

const available = existsSync('.northway-local/auth/auth') && existsSync('.northway-local/postgrest');

describe.skipIf(!available)('Northway Plans with Supabase Auth, PostgREST and RLS', () => {
  let stack: any;
  const client = () => createClient(stack.url, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  async function signedIn(account: { email: string; password: string }): Promise<SupabaseClient> {
    const c = client();
    const { error } = await c.auth.signInWithPassword(account);
    if (error) throw error;
    return c;
  }
  const plan = () => {
    const project = createDefaultProject('Test');
    project.floors[0].walls = rectangleWalls();
    project.floors[0].surveyFindings = [{ id: 'hm', layer: 'survey-findings', code: 'HM', shape: 'rect', x: 10, y: 20, width: 100, height: 50 }];
    return project;
  };

  beforeAll(async () => { stack = await startLocalStack({ port: 56321 }); }, 120_000);
  afterAll(async () => { await stack?.stop(); });

  it('rejects requests without the project API key', async () => {
    const response = await fetch(`${stack.url}/rest/v1/floor_plan_projects?select=id`);
    expect(response.status).toBe(401);
  });

  it('gives signed-out visitors no read or write access', async () => {
    const brad = await signedIn(LOCAL_STAFF[0]);
    await createProject(brad, { project_name: 'Private survey', customer_name: 'Smith', property_address: '14 Moor Lane' }, plan());
    const anon = client();
    const read = await anon.from('floor_plan_projects').select('id, project_name');
    expect(read.data ?? []).toEqual([]);
    expect(read.error?.code).toBe('42501'); // permission denied: anon has no grant at all
    const write = await anon.from('floor_plan_projects').insert({ project_name: 'x', project_data: {} });
    expect(write.error).not.toBeNull();
    const staff = await anon.from('northway_plan_staff').select('user_id');
    expect(staff.data ?? []).toEqual([]);
  });

  it('does not allow public sign-up', async () => {
    const { data, error } = await client().auth.signUp({ email: 'stranger@example.test', password: 'Stranger-pass-1' });
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it('rejects wrong passwords', async () => {
    const { error } = await client().auth.signInWithPassword({ email: LOCAL_STAFF[0].email, password: 'wrong-password' });
    expect(error).not.toBeNull();
  });

  it('shows signed-in accounts that are not Northway staff nothing', async () => {
    const outsider = await signedIn(LOCAL_OUTSIDER);
    expect(await listProjects(outsider)).toEqual([]);
    await expect(createProject(outsider, { project_name: 'Sneaky' }, plan())).rejects.toThrow(/row-level security/);
    const brad = await signedIn(LOCAL_STAFF[0]);
    const target = (await listProjects(brad))[0];
    const update = await outsider.from('floor_plan_projects').update({ project_name: 'Hacked' }).eq('id', target.id).select('id');
    expect(update.data).toEqual([]);
    const removal = await outsider.from('floor_plan_projects').delete().eq('id', target.id).select('id');
    expect(removal.data).toEqual([]);
    expect((await getProject(brad, target.id))?.project_name).toBe('Private survey');
  });

  it('lets every staff member work on every plan, with server-owned bookkeeping', async () => {
    const brad = await signedIn(LOCAL_STAFF[0]), lewis = await signedIn(LOCAL_STAFF[1]);
    const created = await createProject(brad, { project_name: '  14 Moor Lane - Smith  ', customer_name: ' ', property_address: '14 Moor Lane' }, plan());
    expect(created).toMatchObject({ project_name: '14 Moor Lane - Smith', customer_name: null, property_address: '14 Moor Lane', revision: 1, schema_version: 3 });
    const row = await lewis.from('floor_plan_projects').select('created_by, updated_by').eq('id', created.id).single();
    expect(row.data!.created_by).toBe(stack.users[LOCAL_STAFF[0].email]);

    // Clients cannot forge authorship or revisions.
    await lewis.from('floor_plan_projects').update({ created_by: stack.users[LOCAL_STAFF[1].email], revision: 99 }).eq('id', created.id);
    const after = await lewis.from('floor_plan_projects').select('created_by, updated_by, revision').eq('id', created.id).single();
    expect(after.data).toEqual({ created_by: stack.users[LOCAL_STAFF[0].email], updated_by: stack.users[LOCAL_STAFF[1].email], revision: 1 });
  });

  it('saves and reopens the complete editable plan, including both overlay layers', async () => {
    const brad = await signedIn(LOCAL_STAFF[0]);
    const imported = createProjectFromRoomPlan(JSON.parse(readFileSync('test-roomplan.json', 'utf8')), 'Scan');
    imported.floors[0].surveyFindings = [
      { id: 'z1', layer: 'survey-findings', ref: 'F1', code: 'HM', name: 'High Moisture', color: '#3b82c4', preset: 'HM', shape: 'rect', x: 0, y: 0, width: 120, height: 80 },
      { id: 'z2', layer: 'survey-findings', ref: 'F2', code: 'WM', name: 'Woodworm Activity', color: '#d9823b', preset: 'WM', shape: 'rect', x: 200, y: 50, width: 60, height: 60 },
      { id: 'z3', layer: 'survey-findings', ref: 'F3', code: 'DP', name: 'Defective Pointing', color: '#5d5fb8', preset: null, shape: 'rect', x: 10, y: 300, width: 90, height: 40 },
    ];
    imported.surveyReferences = { F: 3, R: 2 };
    imported.floors[0].recommendedWorks = [
      { id: 'r1', layer: 'recommended-works', ref: 'R1', code: 'WT', name: 'Woodworm Treatment', color: '#d68a2e', preset: 'WT', priority: 'priority_2', shape: 'rect', x: 200, y: 50, width: 60, height: 60 },
      { id: 'r2', layer: 'recommended-works', ref: 'R2', code: 'OF', name: 'Open Floor for Further Inspection', color: '#6f8197', preset: null, priority: 'further_investigation', shape: 'rect', x: 0, y: 0, width: 120, height: 80 },
    ];
    const created = await createProject(brad, { project_name: 'Stage 3 Test Property' }, imported);
    expect((created.project_data as any).id).toBe(created.id); // the document carries its row id
    const reopened = documentToProject((await getProject(brad, created.id))!);
    expect(reopened.id).toBe(created.id);
    expect(reopened.name).toBe('Stage 3 Test Property');
    const floor = reopened.floors[0], original = imported.floors[0];
    for (const key of ['walls', 'doors', 'windows', 'furniture', 'rooms', 'surveyFindings', 'recommendedWorks'] as const) expect(floor[key]).toEqual(original[key]);

    reopened.floors[0].surveyFindings![0].x = 40;
    const saved = await saveProject(brad, created.id, 1, reopened, 'Stage 3 Test Property - edited');
    expect(saved.revision).toBe(2);
    const again = (await getProject(brad, created.id))!;
    expect(again.project_name).toBe('Stage 3 Test Property - edited');
    expect(documentToProject(again).floors[0].surveyFindings![0].x).toBe(40);
    // The previous good document is kept for recovery.
    const previous = await brad.from('floor_plan_projects').select('previous_project_data').eq('id', created.id).single();
    expect((previous.data!.previous_project_data as any).floors[0].surveyFindings[0].x).toBe(0);

    // A duplicate carries both layers, custom zones included, and is independent.
    const copy = documentToProject((await getProject(brad, (await duplicateProject(brad, created.id)).id))!);
    expect(copy.floors[0].surveyFindings).toEqual(documentToProject(again).floors[0].surveyFindings);
    expect(copy.floors[0].recommendedWorks).toEqual(original.recommendedWorks);
  });

  it('opens plans saved before Recommended Works and references existed', async () => {
    const brad = await signedIn(LOCAL_STAFF[0]);
    const created = await createProject(brad, { project_name: 'Stage 3 plan' }, plan());
    // A Stage 3 document: findings without name, colour or preset, and no recommendedWorks.
    const stage3 = structuredClone(created.project_data) as any;
    stage3.floors[0].surveyFindings = [{ id: 'old', layer: 'survey-findings', code: 'PD', shape: 'rect', x: 5, y: 6, width: 70, height: 80 }];
    delete stage3.surveyReferences;
    const written = await brad.from('floor_plan_projects').update({ project_data: stage3, schema_version: 1 }).eq('id', created.id).select('revision').single();
    expect(written.error).toBeNull();
    const opened = documentToProject((await getProject(brad, created.id))!);
    expect(opened.floors[0].surveyFindings).toEqual([{ id: 'old', layer: 'survey-findings', ref: 'F1', code: 'PD', name: 'Penetrating Damp', color: '#1f4f8f', preset: 'PD', shape: 'rect', x: 5, y: 6, width: 70, height: 80 }]);
    expect(opened.floors[0].recommendedWorks).toBeUndefined();
    await expect(saveProject(brad, created.id, written.data!.revision, opened, 'Stage 3 plan')).resolves.toMatchObject({ revision: written.data!.revision + 1 });
  });

  it('refuses stale saves and corrupt documents without touching the saved plan', async () => {
    const brad = await signedIn(LOCAL_STAFF[0]), lewis = await signedIn(LOCAL_STAFF[1]);
    const created = await createProject(brad, { project_name: 'Shared' }, plan());
    const mine = documentToProject((await getProject(brad, created.id))!), theirs = documentToProject((await getProject(lewis, created.id))!);
    theirs.floors[0].walls[0].thickness = 30;
    await saveProject(lewis, created.id, 1, theirs, 'Shared');
    mine.floors[0].walls[0].thickness = 20;
    const conflict = await saveProject(brad, created.id, 1, mine, 'Shared').catch(error => error);
    expect(conflict).toBeInstanceOf(ProjectConflictError);
    expect(conflict.serverRevision).toBe(2);

    const corrupt = documentToProject((await getProject(brad, created.id))!);
    (corrupt.floors[0].walls[0] as any).start = null;
    await expect(saveProject(brad, created.id, 2, corrupt, 'Shared')).rejects.toThrow(/Invalid project/);
    expect(documentToProject((await getProject(brad, created.id))!).floors[0].walls[0].thickness).toBe(30);
  });

  it('renames without disturbing an open editor, duplicates independently and deletes one plan', async () => {
    const brad = await signedIn(LOCAL_STAFF[0]);
    const created = await createProject(brad, { project_name: 'Original', customer_name: 'Jones', property_address: '27 Main Street' }, plan());
    const renamed = await updateMetadata(brad, created.id, { project_name: 'Jones - Woodworm Survey', customer_name: 'Jones', property_address: '' });
    expect(renamed).toMatchObject({ project_name: 'Jones - Woodworm Survey', property_address: null });
    expect((await getProject(brad, created.id))!.revision).toBe(1); // a rename is not a plan edit

    const copy = await duplicateProject(brad, created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy).toMatchObject({ project_name: 'Jones - Woodworm Survey (Copy)', customer_name: 'Jones' });
    expect(((await getProject(brad, copy.id))!.project_data as any).id).toBe(copy.id);
    const copyProject = documentToProject((await getProject(brad, copy.id))!);
    copyProject.floors[0].surveyFindings = [];
    await saveProject(brad, copy.id, 1, copyProject, copy.project_name);
    expect(documentToProject((await getProject(brad, created.id))!).floors[0].surveyFindings).toHaveLength(1);

    const before = (await listProjects(brad)).length;
    await deleteProject(brad, copy.id);
    expect(await listProjects(brad)).toHaveLength(before - 1);
    expect(await getProject(brad, copy.id)).toBeNull();
    expect(await getProject(brad, created.id)).not.toBeNull();
    await expect(deleteProject(brad, copy.id)).rejects.toBeInstanceOf(ProjectMissingError);
  });

  it('lists newest first without downloading plan data', async () => {
    const brad = await signedIn(LOCAL_STAFF[0]);
    const list = await listProjects(brad);
    expect(list.length).toBeGreaterThan(2);
    expect(Object.keys(list[0]).sort()).toEqual(['created_at', 'customer_name', 'id', 'project_name', 'property_address', 'updated_at']);
    const times = list.map(p => Date.parse(p.updated_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
