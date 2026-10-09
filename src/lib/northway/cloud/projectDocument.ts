/**
 * Northway Plans: the stored form of an editable project.
 *
 * project_data holds the same complete Project JSON that "Download JSON" exports
 * (walls, rooms, doors, windows, fixtures, Survey Finding zones, floors, images,
 * retained iPhone package data…). It is validated with the editor's own
 * readProject() on the way in and on the way out, so a corrupt document is never
 * written over a good one, and an older document is upgraded by the same rules
 * that open older local files.
 */
import type { Project } from '$lib/models/types';
import { readProject } from '$lib/utils/projectValidation';

/**
 * Format of project_data.
 * 1: OpenPlan3D web project document with Northway fields (surveyFindings, …).
 * Bump only for a change readProject() cannot absorb, and add a step to migrateDocument().
 */
export const CURRENT_SCHEMA_VERSION = 1;

export interface ProjectMetadata {
  project_name: string;
  customer_name: string | null;
  property_address: string | null;
}

export class NewerSchemaError extends Error {
  constructor(version: number) {
    super(`This plan was saved by a newer version of Northway Plans (format ${version}). Reload the page to update, then open it again.`);
    this.name = 'NewerSchemaError';
  }
}

/** Trim; empty optional fields become null; the name is required. */
export function cleanMetadata(input: { project_name?: string | null; customer_name?: string | null; property_address?: string | null }): ProjectMetadata {
  const optional = (value: string | null | undefined) => (value ?? '').trim() || null;
  const project_name = (input.project_name ?? '').trim();
  if (!project_name) throw new Error('Enter a project name.');
  if (project_name.length > 200) throw new Error('Project names can be up to 200 characters.');
  const customer_name = optional(input.customer_name), property_address = optional(input.property_address);
  if (customer_name && customer_name.length > 200) throw new Error('Customer names can be up to 200 characters.');
  if (property_address && property_address.length > 500) throw new Error('Property addresses can be up to 500 characters.');
  return { project_name, customer_name, property_address };
}

/** Validated, plain-JSON document ready for project_data. Throws rather than store a damaged plan. */
export function projectToDocument(project: Project, projectName: string): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(project));
  const valid = readProject(plain);
  valid.name = projectName;
  return JSON.parse(JSON.stringify(valid));
}

/** Upgrade an older stored document to CURRENT_SCHEMA_VERSION. */
export function migrateDocument(data: unknown, version: number): unknown {
  if (!Number.isInteger(version) || version < 1) throw new Error('This plan has an unrecognised format version.');
  if (version > CURRENT_SCHEMA_VERSION) throw new NewerSchemaError(version);
  // Version 1 is current; future steps go here (for example: if (version < 2) data = toV2(data)).
  return data;
}

/** Open a stored row as an editor project. The row id is the project's id everywhere. */
export function documentToProject(row: { id: string; project_name: string; project_data: unknown; schema_version: number }): Project {
  const project = readProject(migrateDocument(row.project_data, row.schema_version));
  project.id = row.id;
  project.name = row.project_name;
  return project;
}
