/**
 * Northway: export metadata kept in the project document (survey date, floor names). The property
 * address and customer stay in the library row (Stage 3); see cloud/session.ts → cloudDetails.
 */
import { get } from 'svelte/store';
import { currentProject, mutateActiveFloor } from '$lib/stores/project';

/** Set or clear the survey date ('YYYY-MM-DD', or '' to clear). */
export function setSurveyDate(date: string) {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
  mutateActiveFloor(() => {
    const project = get(currentProject);
    if (!project) return;
    if (value) project.surveyDate = value; else delete project.surveyDate;
  }, 'Set survey date', 'survey-date');
}

/** Rename a floor (Ground Floor, First Floor, Cellar, …); shown on exports. */
export function setFloorName(floorId: string, name: string) {
  const value = name.trim().slice(0, 80);
  if (!value) return;
  mutateActiveFloor(() => {
    const floor = get(currentProject)?.floors.find(f => f.id === floorId);
    if (floor) floor.name = value;
  }, 'Renamed floor', `floor-name:${floorId}`);
}

/** '2026-10-09' → '9 October 2026' (UK style, as in the written report). */
export function formatSurveyDate(date: string | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
