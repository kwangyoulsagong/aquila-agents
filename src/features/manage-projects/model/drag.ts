// Drag a project row to reorder it or move it to another group. Like sessionDrag, the id is kept here
// because `dataTransfer` can't be read during dragover.
import type { Project } from '@/shared/api';

const PROJECT_DRAG_TYPE = 'application/x-aquila-project';

type DragLike = { dataTransfer: DataTransfer | null };

let dragging: string | null = null;

export function startProjectDrag(e: DragLike, projectId: string): void {
  dragging = projectId;
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(PROJECT_DRAG_TYPE, projectId);
  e.dataTransfer.effectAllowed = 'move';
}

export function endProjectDrag(): void {
  dragging = null;
}

/** The project being dragged, if the drag carries one (tabs and files are ignored). */
export function draggedProject(e: DragLike): string | null {
  return e.dataTransfer?.types.includes(PROJECT_DRAG_TYPE) ? dragging : null;
}

export type DropPos = 'before' | 'after';

/** Upper half of the hovered row → before it, lower half → after. */
export const dropPos = (clientY: number, rect: { top: number; height: number }): DropPos =>
  clientY < rect.top + rect.height / 2 ? 'before' : 'after';

/**
 * Where `draggedId` lands when dropped `pos` the row `overId`: that row's group, and the index among the
 * group's other projects (what `moveProject` expects). null = no move.
 */
export function dropTarget(
  projects: Project[],
  draggedId: string,
  overId: string,
  pos: DropPos,
): { group: string; index: number } | null {
  const over = projects.find((p) => p.id === overId);
  if (!over || draggedId === overId) return null;
  const members = projects.filter((p) => p.group === over.group && p.id !== draggedId);
  const i = members.findIndex((p) => p.id === overId);
  return { group: over.group, index: pos === 'before' ? i : i + 1 };
}
