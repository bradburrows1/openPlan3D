import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanMetadata, documentToProject, migrateDocument, projectToDocument, CURRENT_SCHEMA_VERSION, NewerSchemaError } from '$lib/northway/cloud/projectDocument';
import { filterProjects } from '$lib/northway/cloud/projectsApi';
import { projectFromFile } from '$lib/northway/cloud/importPlan';
import { roomProject } from './fixtures/project';

it('requires a project name and keeps customer and address optional', () => {
  expect(cleanMetadata({ project_name: '  14 Moor Lane - Smith ', customer_name: '  ', property_address: undefined }))
    .toEqual({ project_name: '14 Moor Lane - Smith', customer_name: null, property_address: null });
  expect(() => cleanMetadata({ project_name: '   ' })).toThrow('Enter a project name.');
  expect(() => cleanMetadata({ project_name: 'x'.repeat(201) })).toThrow(/200/);
});

it('stores the complete project and refuses damaged documents', () => {
  const project = roomProject();
  project.floors[0].surveyFindings = [{ id: 'z', layer: 'survey-findings', code: 'DP', name: 'Defective Pointing', color: '#5d5fb8', preset: null, shape: 'rect', x: 1, y: 2, width: 3, height: 4 }];
  project.floors[0].recommendedWorks = [{ id: 'r', layer: 'recommended-works', code: 'WT', name: 'Woodworm Treatment', color: '#d9823b', preset: 'WT', shape: 'rect', x: 1, y: 2, width: 3, height: 4 }];
  const document = projectToDocument(project, 'Named') as any;
  expect(document.name).toBe('Named');
  expect(document.floors[0].walls).toEqual(JSON.parse(JSON.stringify(project.floors[0].walls)));
  expect(document.floors[0].surveyFindings).toEqual(project.floors[0].surveyFindings);
  expect(document.floors[0].recommendedWorks).toEqual(project.floors[0].recommendedWorks);
  (project.floors[0].walls[0] as any).thickness = 'thick';
  expect(() => projectToDocument(project, 'Named')).toThrow(/Invalid project/);
});

it('opens current documents, and refuses newer formats instead of damaging them', () => {
  const document = projectToDocument(roomProject(), 'Saved');
  const opened = documentToProject({ id: '0b2c7e5a-4f3a-4b8e-9a5f-3c2d1e0f9a8b', project_name: 'Renamed', project_data: document, schema_version: CURRENT_SCHEMA_VERSION });
  expect(opened.id).toBe('0b2c7e5a-4f3a-4b8e-9a5f-3c2d1e0f9a8b');
  expect(opened.name).toBe('Renamed');
  expect(() => migrateDocument(document, CURRENT_SCHEMA_VERSION + 1)).toThrow(NewerSchemaError);
  expect(() => migrateDocument(document, 0)).toThrow(/format/);
});

it('searches name, customer and property address', () => {
  const projects = [
    { project_name: '14 Moor Lane - Smith', customer_name: 'Smith', property_address: '14 Moor Lane, Leeds' },
    { project_name: 'Jones - Woodworm Survey', customer_name: null, property_address: '27 Main Street' },
  ];
  expect(filterProjects(projects, 'woodworm').map(p => p.project_name)).toEqual(['Jones - Woodworm Survey']);
  expect(filterProjects(projects, 'main street')).toHaveLength(1);
  expect(filterProjects(projects, 'SMITH leeds')).toHaveLength(1);
  expect(filterProjects(projects, '')).toHaveLength(2);
});

it('imports RoomPlan scans and OpenPlan3D files with a suggested name', async () => {
  const roomplan = new File([readFileSync('test-roomplan.json')], 'Survey scan.json', { type: 'application/json' });
  const scan = await projectFromFile(roomplan);
  expect(scan.suggestedName).toBe('Survey scan');
  expect(scan.project.floors[0].walls.length).toBeGreaterThan(0);
  const native = new File([JSON.stringify(roomProject())], 'Regression plan.openplan.json');
  const opened = await projectFromFile(native);
  expect(opened.suggestedName).toBe('Regression plan');
  await expect(projectFromFile(new File(['not json'], 'broken.json'))).rejects.toThrow(/not valid JSON/);
});
