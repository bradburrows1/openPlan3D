/**
 * Northway Plans: turn an imported file into an editable project, using the
 * editor's existing importers. Supported: Apple RoomPlan JSON or .zip,
 * OpenPlan3D / Northway project JSON ("Download JSON"), and OpenPlan3D project
 * packages (.zip from the iPhone app or "Export project package").
 */
import type { Project } from '$lib/models/types';
import { createProjectFromRoomPlan, extractRoomJsonFromZip, isRoomPlanJson } from '$lib/utils/roomplanImport';
import { readProject } from '$lib/utils/projectValidation';
import { IMPORT_FAILURE, logFailure } from './errors';

const IMPORT_LIMIT = 64 * 1024 * 1024;

function baseName(fileName: string) {
  return fileName.replace(/\.openplan\.json$/i, '').replace(/\.(json|zip)$/i, '').trim() || 'Imported plan';
}

/**
 * Every failure becomes one plain message for staff; the technical reason goes to the console only.
 * The file is validated (readProject or the RoomPlan importer) before anything reaches the editor.
 */
export async function projectFromFile(file: File): Promise<{ project: Project; suggestedName: string }> {
  if (file.size > IMPORT_LIMIT) throw new Error('This file is larger than 64 MB, so it could not be imported.');
  try { return await readPlanFile(file); }
  catch (error) {
    logFailure('import plan', error);
    throw new Error(IMPORT_FAILURE);
  }
}

async function readPlanFile(file: File): Promise<{ project: Project; suggestedName: string }> {
  const name = baseName(file.name);
  if (/\.zip$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { readPackageZip } = await import('$lib/utils/projectPackageZip');
    let entries: Record<string, Uint8Array> | null = null;
    try { entries = readPackageZip(bytes); } catch { /* not an OpenPlan3D package; try RoomPlan */ }
    if (entries?.['manifest.json']) {
      const { readProjectPackage } = await import('$lib/services/projectPackage');
      const { project } = readProjectPackage(bytes);
      return { project, suggestedName: project.name || name };
    }
    return { project: createProjectFromRoomPlan(await extractRoomJsonFromZip(file), name), suggestedName: name };
  }
  let data: unknown;
  data = JSON.parse(await file.text());
  if (isRoomPlanJson(data)) return { project: createProjectFromRoomPlan(data, name), suggestedName: name };
  const project = readProject(data);
  return { project, suggestedName: project.name && project.name !== 'Untitled Project' ? project.name : name };
}
