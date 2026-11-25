// Tab order (drag a tab along the bar). Pure: the workspace keeps the list, the tab bar only says where it was dropped.

/** Which side of the tab under the pointer the dragged tab lands on. */
export type DropSide = 'before' | 'after';

/** Left half of a tab → before it, right half → after it. */
export function dropSide(clientX: number, rect: { left: number; width: number }): DropSide {
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

/**
 * The tab a drag at `x` lands on, from the tabs' boxes left → right: the one under the pointer, else the first /
 * last when the pointer is past either end. null when there are no tabs.
 */
export function tabAt(
  x: number,
  tabs: readonly { id: string; left: number; width: number }[],
): { id: string; side: DropSide } | null {
  if (!tabs.length) return null;
  const hit =
    tabs.find((t) => x >= t.left && x < t.left + t.width) ??
    (x < tabs[0]!.left ? tabs[0]! : tabs[tabs.length - 1]!);
  return { id: hit.id, side: dropSide(x, hit) };
}

/**
 * `list` with `id` moved right before / after `targetId`. Returns `list` itself when nothing moves (unknown ids, a
 * tab dropped on itself or where it already is), so a no-op drop doesn't re-render or re-save.
 */
export function moveSession<T extends { id: string }>(
  list: T[],
  id: string,
  targetId: string,
  side: DropSide,
): T[] {
  if (id === targetId) return list;
  const from = list.findIndex((s) => s.id === id);
  if (from < 0 || !list.some((s) => s.id === targetId)) return list;
  const rest = list.filter((s) => s.id !== id);
  const at = rest.findIndex((s) => s.id === targetId) + (side === 'after' ? 1 : 0);
  if (at === from) return list;
  return [...rest.slice(0, at), list[from], ...rest.slice(at)];
}
