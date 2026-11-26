// Map labels that never overlap (T73). Sigma picks labels per grid cell without measuring them, so long titles
// (Korean ones especially) ran into each other. Here each candidate's real box is measured and placed greedily —
// most important first — and a label that would touch one already placed stays hidden (its node is still there,
// hover shows it).

export interface LabelCandidate {
  id: string;
  /** Node centre on screen (px). */
  x: number;
  y: number;
  /** Node radius on screen (px). */
  r: number;
  /** Text width (px). */
  width: number;
  /** Higher first: pinned (search / lens hit), then bigger nodes. */
  priority: number;
}

/** Text height of a label box, plus the gap kept between two labels. */
const HEIGHT = 14;
const GAP = 2;
/** Space between the node and its label (sigma draws labels to the right). */
const OFFSET = 3;
/** Spatial hash cell. */
const CELL = 64;

/** Ids of the labels to show: no two boxes overlap, a node's own disc never covers another label either. */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  view: { width: number; height: number },
  /** Every node drawn (a label must not run under a dot either). Default: the candidates. */
  discs: readonly { id: string; x: number; y: number; r: number }[] = candidates,
): Set<string> {
  const order = [...candidates].sort(
    (a, b) => b.priority - a.priority || b.r - a.r || a.id.localeCompare(b.id),
  );
  const grid = new Map<string, { x1: number; y1: number; x2: number; y2: number }[]>();
  const cells = (b: { x1: number; y1: number; x2: number; y2: number }) => {
    const out: string[] = [];
    for (let cx = Math.floor(b.x1 / CELL); cx <= Math.floor(b.x2 / CELL); cx++)
      for (let cy = Math.floor(b.y1 / CELL); cy <= Math.floor(b.y2 / CELL); cy++) out.push(`${cx},${cy}`);
    return out;
  };
  const hits = (b: { x1: number; y1: number; x2: number; y2: number }) =>
    cells(b).some((k) =>
      (grid.get(k) ?? []).some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1),
    );
  const add = (b: { x1: number; y1: number; x2: number; y2: number }) => {
    for (const k of cells(b)) (grid.get(k) ?? grid.set(k, []).get(k)!).push(b);
  };
  // Dots first: a label never runs under one (its own sits left of the label, so it never touches it).
  for (const d of discs) add({ x1: d.x - d.r, y1: d.y - d.r, x2: d.x + d.r, y2: d.y + d.r });
  const shown = new Set<string>();
  for (const c of order) {
    const x1 = c.x + c.r + OFFSET;
    const box = {
      x1: x1 - GAP,
      y1: c.y - HEIGHT / 2 - GAP,
      x2: x1 + c.width + GAP,
      y2: c.y + HEIGHT / 2 + GAP,
    };
    // Only labels wholly on screen (a label cut at the edge read as a different word).
    if (box.x1 < 0 || box.x2 > view.width || box.y1 < 0 || box.y2 > view.height) continue;
    if (hits(box)) continue;
    add(box);
    shown.add(c.id);
  }
  return shown;
}
