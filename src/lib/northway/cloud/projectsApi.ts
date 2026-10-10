/**
 * Northway Plans: floor_plan_projects access. Every call runs as the signed-in
 * user, so Row Level Security decides what is visible; nothing here uses a
 * service key. Functions take the client as a parameter so they can be tested
 * against a real local stack.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Project } from '$lib/models/types';
import { actionFailureMessage, logFailure } from './errors';
import { CURRENT_SCHEMA_VERSION, cleanMetadata, projectToDocument, type ProjectMetadata } from './projectDocument';

export const TABLE = 'floor_plan_projects';

export interface ProjectSummary extends ProjectMetadata {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow extends ProjectSummary {
  project_data: unknown;
  schema_version: number;
  revision: number;
}

/** The plan was saved elsewhere after this editor opened it. */
export class ProjectConflictError extends Error {
  constructor(readonly serverRevision: number) {
    super('This plan was saved from another window or device after you opened it.');
    this.name = 'ProjectConflictError';
  }
}

export class ProjectMissingError extends Error {
  constructor() {
    super('This plan no longer exists. It may have been deleted. Save your work as a new plan or download a JSON backup.');
    this.name = 'ProjectMissingError';
  }
}

const SUMMARY = 'id, project_name, customer_name, property_address, created_at, updated_at';

function fail(error: { message: string; code?: string } | null, action: string): void {
  if (!error) return;
  // Staff see plain English; the technical detail (never a payload) goes to the console.
  logFailure(action, error);
  throw Object.assign(new Error(actionFailureMessage(action, error)), { code: error.code, cause: error });
}

/** Library listing, most recently updated first. project_data is not downloaded. */
export async function listProjects(client: SupabaseClient): Promise<ProjectSummary[]> {
  const { data, error } = await client.from(TABLE).select(SUMMARY).order('updated_at', { ascending: false });
  fail(error, 'load your plans');
  return (data ?? []) as ProjectSummary[];
}

export async function getProject(client: SupabaseClient, id: string): Promise<ProjectRow | null> {
  const { data, error } = await client.from(TABLE).select(`${SUMMARY}, project_data, schema_version, revision`).eq('id', id).maybeSingle();
  fail(error, 'open this plan');
  return data as ProjectRow | null;
}

export async function createProject(client: SupabaseClient, input: Partial<ProjectMetadata>, project: Project): Promise<ProjectRow> {
  const meta = cleanMetadata(input);
  // The row id is chosen here so the stored document carries the same id.
  const id = crypto.randomUUID();
  const document = projectToDocument({ ...project, id }, meta.project_name);
  const { data, error } = await client.from(TABLE)
    .insert({ id, ...meta, project_data: document, schema_version: CURRENT_SCHEMA_VERSION })
    .select(`${SUMMARY}, project_data, schema_version, revision`).single();
  fail(error, 'create this plan');
  return data as ProjectRow;
}

/**
 * Save the editable project. The update only applies if the stored revision is
 * still the one this editor loaded, so two people saving cannot silently
 * overwrite each other. The write is a single row update: a failed request
 * leaves the previous saved plan untouched.
 */
export async function saveProject(client: SupabaseClient, id: string, expectedRevision: number, project: Project, projectName: string): Promise<{ revision: number; updated_at: string }> {
  const meta = cleanMetadata({ project_name: projectName });
  const document = projectToDocument(project, meta.project_name); // validate before touching the network
  const { data, error } = await client.from(TABLE)
    .update({ project_name: meta.project_name, project_data: document, schema_version: CURRENT_SCHEMA_VERSION })
    .eq('id', id).eq('revision', expectedRevision)
    .select('revision, updated_at');
  fail(error, 'save this plan');
  if (data && data.length === 1) return data[0] as { revision: number; updated_at: string };
  const { data: current, error: lookupError } = await client.from(TABLE).select('revision').eq('id', id).maybeSingle();
  fail(lookupError, 'save this plan');
  if (!current) throw new ProjectMissingError();
  throw new ProjectConflictError((current as { revision: number }).revision);
}

/** Rename / edit customer and property. Does not touch the plan itself. */
export async function updateMetadata(client: SupabaseClient, id: string, input: Partial<ProjectMetadata>): Promise<ProjectSummary> {
  const meta = cleanMetadata(input);
  const { data, error } = await client.from(TABLE).update(meta).eq('id', id).select(SUMMARY);
  fail(error, 'rename this plan');
  if (!data?.length) throw new ProjectMissingError();
  return data[0] as ProjectSummary;
}

/** Copy the saved plan and its details into a new, independent project. */
export async function duplicateProject(client: SupabaseClient, id: string): Promise<ProjectSummary> {
  const source = await getProject(client, id);
  if (!source) throw new ProjectMissingError();
  const name = `${source.project_name} (Copy)`.slice(0, 200);
  const copyId = crypto.randomUUID();
  const document = { ...(source.project_data as Record<string, unknown>), id: copyId, name };
  const { data, error } = await client.from(TABLE)
    .insert({ id: copyId, project_name: name, customer_name: source.customer_name, property_address: source.property_address,
      project_data: document, schema_version: source.schema_version })
    .select(SUMMARY).single();
  fail(error, 'duplicate this plan');
  return data as ProjectSummary;
}

/** Delete exactly one project by id; reports if nothing was deleted. */
export async function deleteProject(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from(TABLE).delete().eq('id', id).select('id');
  fail(error, 'delete this plan');
  if (!data?.length) throw new ProjectMissingError();
}

/** Client-side library search over name, customer and address. */
export function filterProjects<T extends ProjectMetadata>(projects: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...projects];
  return projects.filter(project => {
    const haystack = [project.project_name, project.customer_name, project.property_address].filter(Boolean).join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
