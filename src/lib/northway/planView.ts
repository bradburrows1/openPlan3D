import { get } from 'svelte/store';
import type { Project } from '$lib/models/types';
import { projectSettings, type ProjectSettings } from '$lib/stores/settings';
import { isSurveyLibrary, planFurniture } from './fixtures';

/**
 * Northway: the project as the current workflow shows it, for exporters.
 * Hidden movable furniture and a hidden Survey Findings layer are left out of
 * the copy; the stored project is never modified.
 */
export function surveyPlanView(project: Project, settings: ProjectSettings = get(projectSettings)): Project {
  const library = isSurveyLibrary(settings), findings = settings.showSurveyFindings !== false;
  if (!library && findings) return project;
  return {
    ...project,
    floors: project.floors.map(floor => ({
      ...floor,
      furniture: planFurniture(floor.furniture, settings),
      ...(findings ? {} : { surveyFindings: [] }),
    })),
  };
}
