import { get } from 'svelte/store';
import type { OverlayLayer, Project } from '$lib/models/types';
import { projectSettings, type ProjectSettings } from '$lib/stores/settings';
import { isSurveyLibrary, planFurniture } from './fixtures';

/** Which overlay layers an export shows. Exports pass their own; the editor's toggles are never changed. */
export type LayerSelection = Record<OverlayLayer, boolean>;

export function settingsLayers(settings: ProjectSettings): LayerSelection {
  return { 'survey-findings': settings.showSurveyFindings !== false, 'recommended-works': settings.showRecommendedWorks !== false };
}

/**
 * Northway: the project as the current workflow shows it, for exporters.
 * Hidden movable furniture and hidden Survey Findings or Recommended Works layers (areas, pins and
 * lines) are left out of the copy; the stored project is never modified. `layers` overrides the
 * editor's layer toggles for one export (Survey Findings Plan, Recommended Works Plan, Combined).
 */
export function surveyPlanView(project: Project, settings: ProjectSettings = get(projectSettings), layers: LayerSelection = settingsLayers(settings)): Project {
  const library = isSurveyLibrary(settings), findings = layers['survey-findings'], works = layers['recommended-works'];
  if (!library && findings && works) return project;
  const shown = (item: { layer: OverlayLayer }) => layers[item.layer];
  return {
    ...project,
    floors: project.floors.map(floor => ({
      ...floor,
      furniture: planFurniture(floor.furniture, settings),
      ...(findings ? {} : { surveyFindings: [] }),
      ...(works ? {} : { recommendedWorks: [] }),
      ...(floor.overlayPins && !(findings && works) ? { overlayPins: floor.overlayPins.filter(shown) } : {}),
      ...(floor.overlayLines && !(findings && works) ? { overlayLines: floor.overlayLines.filter(shown) } : {}),
    })),
  };
}
