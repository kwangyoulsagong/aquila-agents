// Drag a session (tab) onto a split pane. The id is also kept here because `dataTransfer` can't be read
// during dragover — the drop target needs it to decide which zones are allowed.

export const SESSION_DRAG_TYPE = 'application/x-aquila-session';

/** Native or React drag event — only `dataTransfer` is used. */
type DragLike = { dataTransfer: DataTransfer | null };

let dragging: string | null = null;

export function startSessionDrag(e: DragLike, sessionId: string): void {
  dragging = sessionId;
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(SESSION_DRAG_TYPE, sessionId);
  e.dataTransfer.effectAllowed = 'move';
}

export function endSessionDrag(): void {
  dragging = null;
}

/** The session being dragged, if the drag carries one. */
export function draggedSession(e: DragLike): string | null {
  return e.dataTransfer?.types.includes(SESSION_DRAG_TYPE) ? dragging : null;
}
