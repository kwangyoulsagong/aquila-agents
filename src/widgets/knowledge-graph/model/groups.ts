import type { GraphNode, GraphNodeKind } from '@/shared/api';
import { topicGroups } from './clusters';
import type { GraphView } from './view';

// The Map as groups (T73). Hundreds of dots read as noise, so the Map starts with a few named groups — note
// folders (`reports`, `specs`), node kinds (Sessions, Code) and the user's own query groups (Obsidian's "Groups":
// a search + a name) — as bubbles with the links between them. A group opens into its sub-folders, and once it
// is small enough (or has no sub-folders) into its dots.

/** A user group: a name and a query (`path:specs tag:db kind:session words`). First matching rule wins. */
export interface GroupRule {
  id: string;
  name: string;
  query: string;
}

/** One step of a node's group path. `kind` set: a node-kind group, named by the UI (translated). */
export interface GroupSeg {
  key: string;
  label: string;
  kind?: GraphNodeKind;
}

/** Path inside its source for a note (`reports/retrospects/x.md`); the label for anything else. */
export function relPathOf(n: GraphNode): string {
  const m = /^note:[^:]+:(.+)$/.exec(n.id);
  return m ? m[1]! : (n.path ?? n.label);
}

/** Does the node match a rule's query? Every term must match; `path:` / `tag:` / `kind:` narrow it. Empty = never. */
export function ruleMatches(n: GraphNode, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return false;
  const path = relPathOf(n).toLowerCase();
  const label = n.label.toLowerCase();
  return terms.every((t) => {
    const [op, ...rest] = t.split(':');
    const v = rest.join(':');
    if (rest.length && v) {
      if (op === 'path') return path.includes(v);
      if (op === 'tag') return !!n.tags?.some((x) => x.toLowerCase() === v.replace(/^#/, ''));
      if (op === 'kind') return n.kind === v;
    }
    return label.includes(t) || path.includes(t);
  });
}

export interface GroupContext {
  rules: readonly GroupRule[];
  /** Source id → its folder name (`requirements`). */
  sourceName: (id: string) => string;
  /** More than one source in view: notes are grouped by source first. */
  multiSource: boolean;
  /** Projects (folder as stored, `~/…`): code names and files are grouped by their folder inside one. */
  projects?: readonly { id: string; name: string; path: string }[];
  /** Several projects in view: code and files are grouped by project first. */
  multiProject?: boolean;
}

/** `~/a/b` → `/a/b/` (matched as a suffix-free fragment of an absolute path; `~` itself → `/`). */
const rootFragment = (p: string) => `${p.replace(/^~/, '').replace(/\/+$/, '')}/`;

/** Project and folders of a code name / changed file inside its project; null when it is in none. */
export function placeInProject(
  n: GraphNode,
  projects: NonNullable<GroupContext['projects']>,
): { project: { id: string; name: string }; dirs: string[] } | null {
  if (!n.path) return null;
  let best: { project: { id: string; name: string }; at: number; len: number } | null = null;
  for (const p of projects) {
    if (n.projects && !n.projects.includes(p.id)) continue;
    const frag = rootFragment(p.path);
    const at = n.path.indexOf(frag);
    if (at >= 0 && (!best || frag.length > best.len))
      best = { project: p, at: at + frag.length, len: frag.length };
  }
  if (!best) return null;
  const rel = n.path.slice(best.at).replace(/\/+$/, '');
  return { project: best.project, dirs: rel.split('/').slice(0, -1).filter(Boolean) };
}

/** Where a node sits: rule → (source →) folders for notes; its kind for anything else. */
export function groupPath(n: GraphNode, ctx: GroupContext): GroupSeg[] {
  const rule = ctx.rules.find((r) => ruleMatches(n, r.query));
  const lead: GroupSeg[] = rule ? [{ key: `rule:${rule.id}`, label: rule.name || rule.query }] : [];
  if (n.kind !== 'note') {
    if (rule) return lead;
    const kind: GroupSeg = { key: `kind:${n.kind}`, label: n.kind, kind: n.kind };
    // Code names and changed files: by folder inside the project (`salt-server/src/coach`), like notes.
    const place =
      (n.kind === 'code' || n.kind === 'file') && ctx.projects ? placeInProject(n, ctx.projects) : null;
    if (!place) return [kind];
    return [
      kind,
      ...(ctx.multiProject ? [{ key: `project:${place.project.id}`, label: place.project.name }] : []),
      ...place.dirs.map((d) => ({ key: `dir:${d}`, label: d })),
    ];
  }
  // Notes in a project: by folder inside the project, whichever source indexed them (a folder the user added
  // inside a project is a source of its own, T73) — the repo's own layout, not the sources'.
  const inProject = ctx.projects ? placeInProject(n, ctx.projects) : null;
  if (inProject) {
    const project: GroupSeg = { key: `project:${inProject.project.id}`, label: inProject.project.name };
    const dirs = inProject.dirs.map((d) => ({ key: `dir:${d}`, label: d }));
    if (ctx.multiProject && !rule) return [project, ...dirs];
    // Notes at the top of the project: a group named after it, so they don't float unnamed.
    return dirs.length || rule ? [...lead, ...dirs] : [project];
  }
  const src = n.sourceId ?? '';
  const name = ctx.sourceName(src);
  if (ctx.multiSource && !rule) lead.push({ key: `src:${src}`, label: name });
  const dirs = relPathOf(n).split('/').slice(0, -1);
  // Notes at the top of a source (no folder): a group named after the source, so they don't float unnamed.
  if (!dirs.length && !rule && !ctx.multiSource) return [{ key: `src:${src}`, label: name }];
  return [...lead, ...dirs.map((d) => ({ key: `dir:${d}`, label: d }))];
}

/** Groups with a colour of their own (`--color-graph-group-<n>`); later ones are neutral. */
export const GROUP_COLOURS = 8;
/** At most this many bubbles on one level; the rest fold into "N more". */
export const MAX_GROUPS = 12;
/** A group this small (or with no sub-folders) opens straight into its dots. */
export const MAP_MAX = 60;
/** The "N more" bubble's key; in a path it means "the groups past the first MAX_GROUPS - 1". */
export const MORE = '…';
/** Nodes directly in a folder that also has sub-folders. */
export const HERE = '·';
/** T75: groups split by links and title words: `topic:<word>·<word>`; `topic:~` = notes that link to little. */
export const TOPIC = 'topic:';
export const TOPIC_REST = 'topic:~';
/** "결제 · 쿠폰" from a topic key. */
export const topicLabel = (key: string): string => key.slice(TOPIC.length).split('·').join(' · ');
/** A path step that is several groups of one level shown together (⌘-click): `UNION` + keys joined by `UNION`. */
export const UNION = '\u0001';
export const unionKey = (keys: readonly string[]): string => UNION + keys.join(UNION);
export const unionKeys = (key: string): string[] | null =>
  key.startsWith(UNION) ? key.slice(1).split(UNION) : null;

export interface GroupItem {
  key: string;
  seg: GroupSeg;
  /** Member node ids. */
  ids: string[];
  /** 1–8: its colour; 0: neutral. */
  colour: number;
  /** "N more": how many groups it folds. */
  folded?: number;
}

export interface GroupLink {
  a: string;
  b: string;
  /** Links between members of the two groups. */
  count: number;
}

export type GroupLevel =
  | { kind: 'groups'; at: string[]; items: GroupItem[]; links: GroupLink[] }
  | { kind: 'map'; at: string[]; ids: Set<string> };

/**
 * The level at `at` (a path of group keys): its groups and the links between them, or — once small enough, or
 * with nothing left to split — the member ids to draw as dots. A level with a single group is skipped (`at` then
 * says where it really is), so a lone folder never costs a click.
 */
export function groupLevel(
  view: GraphView,
  paths: ReadonlyMap<string, GroupSeg[]>,
  at: readonly string[],
): GroupLevel {
  const path = at;
  // Groups of `ids` by the segment at `depth`. `topic`: split by links and title words (T75), not a path step.
  type Group = { seg: GroupSeg; ids: string[]; topic?: boolean };
  const split = (ids: string[], depth: number): Group[] => {
    const by = new Map<string, Group>();
    for (const id of ids) {
      const seg = paths.get(id)?.[depth] ?? { key: HERE, label: HERE };
      const g = by.get(seg.key);
      if (g) g.ids.push(id);
      else by.set(seg.key, { seg, ids: [id] });
    }
    return [...by.values()].sort(
      (a, b) =>
        Number(a.seg.key === HERE) - Number(b.seg.key === HERE) ||
        b.ids.length - a.ids.length ||
        a.seg.label.localeCompare(b.seg.label),
    );
  };

  // A big set with no folders left (everything directly here): split by how it links and what its titles say,
  // which works in any repo (T75). Null from `topicGroups` (nothing to split by) leaves the dots.
  const level = (ids: string[], depth: number): Group[] => {
    const groups = split(ids, depth);
    if (ids.length <= MAP_MAX || groups.length !== 1 || groups[0]!.seg.key !== HERE) return groups;
    const topics = topicGroups(view, ids);
    return topics
      ? topics.map((tp) => ({ seg: { key: tp.key, label: tp.words.join(' · ') }, ids: tp.ids, topic: true }))
      : groups;
  };

  let ids = view.nodes.map((n) => n.id);
  let depth = 0;
  let groups = level(ids, 0);
  const out: string[] = [];
  const into = (g: Group) => {
    out.push(g.seg.key);
    ids = g.ids;
    // A topic is a split of this level, not a folder deeper: the members' paths stay where they are.
    if (!g.topic) depth++;
    groups = level(ids, depth);
  };
  for (let i = 0; ;) {
    const want = path[i];
    if (want === MORE && groups.length > MAX_GROUPS) {
      groups = groups.slice(MAX_GROUPS - 1);
      ids = groups.flatMap((g) => g.ids);
      out.push(MORE);
      i++;
      continue;
    }
    // Several groups together: their dots, in one picture.
    const together = want === undefined ? null : unionKeys(want);
    if (together) {
      const picked = groups.filter((g) => together.includes(g.seg.key));
      if (picked.length) {
        // Their contents merge by name (both repos' `requirements` → one group) and split on like any level.
        out.push(unionKey(picked.map((g) => g.seg.key)));
        ids = picked.flatMap((g) => g.ids);
        depth++;
        groups = level(ids, depth);
        i++;
        continue;
      }
    }
    const next = want === undefined || together ? undefined : groups.find((g) => g.seg.key === want);
    if (next) {
      into(next);
      i++;
      continue;
    }
    // The path ends here (or a group the filters emptied): stop following it.
    i = path.length;
    const only = groups.length === 1 ? groups[0]! : null;
    if (ids.length <= MAP_MAX || only?.seg.key === HERE) return { kind: 'map', at: out, ids: new Set(ids) };
    if (!only) break;
    // A level with one group costs no click.
    into(only);
  }

  const shown = groups.length > MAX_GROUPS ? groups.slice(0, MAX_GROUPS - 1) : groups;
  const items: GroupItem[] = shown.map((g, i) => ({
    key: g.seg.key,
    seg: g.seg,
    ids: g.ids,
    colour: i < GROUP_COLOURS ? i + 1 : 0,
  }));
  if (groups.length > MAX_GROUPS) {
    const rest = groups.slice(MAX_GROUPS - 1);
    items.push({
      key: MORE,
      seg: { key: MORE, label: MORE },
      ids: rest.flatMap((g) => g.ids),
      colour: 0,
      folded: rest.length,
    });
  }
  const itemOf = new Map<string, string>();
  for (const it of items) for (const id of it.ids) itemOf.set(id, it.key);
  const counts = new Map<string, GroupLink>();
  for (const e of view.edges) {
    const a = itemOf.get(e.source);
    const b = itemOf.get(e.target);
    if (!a || !b || a === b) continue;
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${x}\0${y}`;
    const l = counts.get(k);
    if (l) l.count++;
    else counts.set(k, { a: x, b: y, count: 1 });
  }
  return { kind: 'groups', at: out, items, links: [...counts.values()] };
}

/**
 * Path lengths a crumb (or Back) can go to: those that open where they say. A level holding a single group is
 * skipped on the way in, so going "back" to it would land right here again — it is no stop. Always ends with `at`.
 */
export function crumbStops(
  view: GraphView,
  paths: ReadonlyMap<string, GroupSeg[]>,
  at: readonly string[],
): number[] {
  const stops: number[] = [];
  for (let k = 0; k <= at.length; k++)
    if (k === at.length || groupLevel(view, paths, at.slice(0, k)).at.length === k) stops.push(k);
  return stops;
}

/** A group's dots: its members, plus — for groups of non-notes (Sessions, Code) — what they link to, for context. */
export function mapView(view: GraphView, ids: ReadonlySet<string>, withNeighbours: boolean): GraphView {
  const keep = new Set(ids);
  if (withNeighbours)
    for (const e of view.edges) {
      if (ids.has(e.source)) keep.add(e.target);
      if (ids.has(e.target)) keep.add(e.source);
    }
  return {
    nodes: view.nodes.filter((n) => keep.has(n.id)),
    edges: view.edges.filter(
      (e) => keep.has(e.source) && keep.has(e.target) && (ids.has(e.source) || ids.has(e.target)),
    ),
  };
}

/** Room a bubble's name and "+N this week" take under it (px), kept clear of the next bubble. */
export const LABEL_ROOM = 40;
/** A grid cell is at least this wide, so a name (`salt-microFe`) doesn't run into the next one. */
const LABEL_WIDTH = 104;

export interface BubbleBox {
  key: string;
  x: number;
  y: number;
  r: number;
}

/**
 * Bubbles on a ring (one in the middle when alone), in an order that keeps linked groups next to each other
 * (greedy: start with the biggest, then the one most linked to the last placed). Radius by √members. Deterministic.
 */
export function bubbleLayout(
  items: readonly GroupItem[],
  links: readonly GroupLink[],
  width: number,
  height: number,
  { min, max, pad }: { min: number; max: number; pad: number },
): BubbleBox[] {
  if (!items.length) return [];
  const n = items.length;
  const biggest = Math.max(...items.map((i) => i.ids.length));
  const sized = (top: number) => (k: number) => {
    const lo = Math.min(min, top);
    return lo + (top - lo) * Math.sqrt(k / biggest);
  };
  const weight = new Map<string, number>();
  for (const l of links) {
    weight.set(`${l.a}\0${l.b}`, l.count);
    weight.set(`${l.b}\0${l.a}`, l.count);
  }
  const order = [items[0]!];
  const left = items.slice(1);
  while (left.length) {
    const last = order[order.length - 1]!.key;
    let best = 0;
    for (let i = 1; i < left.length; i++)
      if ((weight.get(`${last}\0${left[i]!.key}`) ?? 0) > (weight.get(`${last}\0${left[best]!.key}`) ?? 0))
        best = i;
    order.push(left.splice(best, 1)[0]!);
  }
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) return [{ key: order[0]!.key, x: cx, y: cy, r: max }];

  // A ring when it fits: neighbours (a chord apart on the ellipse's shorter side) clear each other and the name
  // under each (two lines). Bubbles shrink towards `min` to make it fit.
  for (let top = max; top >= min; top -= 2) {
    const rx = cx - top - pad;
    const ry = cy - top - pad * 2;
    if (Math.min(rx, ry) <= top) continue;
    const gap = 2 * Math.min(rx, ry) * Math.sin(Math.PI / n);
    if (gap < 2 * top + LABEL_ROOM) continue;
    const radius = sized(top);
    return order.map((it, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return { key: it.key, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), r: radius(it.ids.length) };
    });
  }
  // Too many for a ring in this box: rows, biggest first, the largest bubbles that still fit (or `min`).
  let top = min;
  for (let r = max; r >= min; r -= 2) {
    const cols = Math.max(1, Math.floor((width - pad) / Math.max(2 * r + pad, LABEL_WIDTH)));
    if (Math.ceil(n / cols) * (2 * r + LABEL_ROOM + pad / 2) <= height - pad) {
      top = r;
      break;
    }
  }
  const radius = sized(top);
  const cellW = Math.max(2 * top + pad, LABEL_WIDTH);
  const cellH = 2 * top + LABEL_ROOM + pad / 2;
  const cols = Math.max(1, Math.min(n, Math.floor((width - pad) / cellW)));
  const rows = Math.ceil(n / cols);
  const x0 = cx - (cols * cellW) / 2 + cellW / 2;
  const y0 = Math.max(pad + top, cy - (rows * cellH) / 2 + top);
  const bySize = [...order].sort((a, b) => b.ids.length - a.ids.length);
  return bySize.map((it, i) => ({
    key: it.key,
    x: x0 + (i % cols) * cellW,
    y: y0 + Math.floor(i / cols) * cellH,
    r: radius(it.ids.length),
  }));
}
