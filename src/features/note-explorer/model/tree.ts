// Note explorer (T83): the tree is built from the index's file list (no disk walk) plus the empty folders read when
// a folder is expanded. Folders first, natural order (2 < 10, FE-REQ-2 < FE-REQ-030), Korean-aware.
import type { NoteFsEntry, NoteFsSort } from '@/shared/api';
import { fuzzyMatch } from '@/shared/lib/fuzzy';

export interface TreeFile {
  kind: 'file';
  rel: string;
  /** File name without `.md`. */
  name: string;
  entry: NoteFsEntry;
}

export interface TreeFolder {
  kind: 'folder';
  rel: string;
  name: string;
  folders: TreeFolder[];
  files: TreeFile[];
  /** Notes inside, all levels. */
  count: number;
}

const collator = new Intl.Collator(['ko', 'en'], { numeric: true, sensitivity: 'base' });
/** Natural order: numbers by value, case and accents ignored, Korean in 가나다 order. */
export const naturalCompare = (a: string, b: string) =>
  collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

export const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
export const dirName = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
export const stripMd = (name: string) => name.replace(/\.md$/i, '');
export const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** `rel` is `folder` or inside it. */
export const within = (rel: string, folder: string) =>
  !folder || rel === folder || rel.startsWith(`${folder}/`);

/** Ancestor folders of a path, outermost first (`a/b/c.md` → `a`, `a/b`). */
export function ancestors(rel: string): string[] {
  const parts = rel.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

function sortFiles(files: TreeFile[], sort: NoteFsSort): void {
  if (sort === 'name') files.sort((a, b) => naturalCompare(a.name, b.name));
  else {
    const key = (f: TreeFile) => (sort === 'created' ? (f.entry.ctime ?? f.entry.mtime) : f.entry.mtime);
    files.sort((a, b) => key(b) - key(a) || naturalCompare(a.name, b.name));
  }
}

/**
 * The tree of a source. `dirs`: folder → empty sub-folders found when it was expanded (folders holding notes come
 * from the paths). Folders are always by name; notes by `sort`.
 */
export function buildTree(
  files: readonly NoteFsEntry[],
  dirs: ReadonlyMap<string, readonly string[]> = new Map(),
  sort: NoteFsSort = 'name',
): TreeFolder {
  const root: TreeFolder = { kind: 'folder', rel: '', name: '', folders: [], files: [], count: 0 };
  const byRel = new Map<string, TreeFolder>([['', root]]);
  const folder = (rel: string): TreeFolder => {
    let f = byRel.get(rel);
    if (f) return f;
    const parent = folder(dirName(rel));
    f = { kind: 'folder', rel, name: baseName(rel), folders: [], files: [], count: 0 };
    parent.folders.push(f);
    byRel.set(rel, f);
    return f;
  };
  for (const e of files) {
    const f = folder(dirName(e.rel));
    f.files.push({ kind: 'file', rel: e.rel, name: stripMd(baseName(e.rel)), entry: e });
    // Every folder on the way up exists (`folder` made them).
    for (let r = f.rel; ; r = dirName(r)) {
      byRel.get(r)!.count++;
      if (!r) break;
    }
  }
  for (const [parent, names] of dirs) {
    if (parent && !byRel.has(parent)) continue; // its parent isn't in the tree (gone)
    for (const n of names) folder(joinRel(parent, n));
  }
  const walk = (f: TreeFolder) => {
    f.folders.sort((a, b) => naturalCompare(a.name, b.name));
    sortFiles(f.files, sort);
    f.folders.forEach(walk);
  };
  walk(root);
  return root;
}

export interface Row {
  kind: 'folder' | 'file';
  rel: string;
  name: string;
  depth: number;
  count?: number;
  open?: boolean;
  entry?: NoteFsEntry;
  /** Matched character indices in `name` (filter). */
  matches?: number[];
}

/**
 * The rows on screen: open folders' contents, in order. With a filter (`only`: the matching notes), only those
 * notes and the folders holding them, every such folder open.
 */
export function flatten(
  root: TreeFolder,
  expanded: ReadonlySet<string>,
  only: ReadonlyMap<string, number[]> | null = null,
): Row[] {
  const out: Row[] = [];
  const keep = (f: TreeFolder): boolean =>
    !only || f.files.some((x) => only.has(x.rel)) || f.folders.some(keep);
  const walk = (f: TreeFolder, depth: number) => {
    for (const d of f.folders) {
      if (!keep(d)) continue;
      const open = only ? true : expanded.has(d.rel);
      out.push({ kind: 'folder', rel: d.rel, name: d.name, depth, count: d.count, open });
      if (open) walk(d, depth + 1);
    }
    for (const x of f.files) {
      if (only && !only.has(x.rel)) continue;
      const m = only?.get(x.rel);
      out.push({
        kind: 'file',
        rel: x.rel,
        name: x.name,
        depth,
        entry: x.entry,
        ...(m?.length ? { matches: m } : {}),
      });
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Notes matching a typed filter, best first: fuzzy over the whole relative path (folders, IDs like `FE-REQ-030`)
 * and the title. Values: the indices in the file name to highlight.
 */
export function filterFiles(files: readonly NoteFsEntry[], query: string): Map<string, number[]> {
  const q = query.trim();
  const scored: { rel: string; score: number; marks: number[] }[] = [];
  if (!q) return new Map();
  for (const f of files) {
    const path = stripMd(f.rel);
    const m = fuzzyMatch(q, path);
    const t = f.title ? fuzzyMatch(q, f.title) : null;
    if (!m && !t) continue;
    const start = path.length - stripMd(baseName(f.rel)).length;
    const marks = m ? m.indices.filter((i) => i >= start).map((i) => i - start) : [];
    // A match in the name itself counts more than one spread over folders.
    const score = Math.max(
      m ? m.score + (marks.length === m.indices.length ? 5 : 0) : -Infinity,
      t?.score ?? -Infinity,
    );
    scored.push({ rel: f.rel, score, marks });
  }
  scored.sort((a, b) => b.score - a.score || naturalCompare(a.rel, b.rel));
  return new Map(scored.map((s) => [s.rel, s.marks]));
}

/**
 * The name to suggest for a new note in a folder whose notes share an ID pattern: `FE-REQ-029`, `FE-REQ-030` →
 * `FE-REQ-031` (same width). Null when no prefix is shared by at least two notes.
 */
export function nextId(names: readonly string[]): string | null {
  const groups = new Map<string, { max: number; width: number; n: number }>();
  for (const name of names) {
    const m = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*-)(\d+)(?![\d])/.exec(name);
    if (!m) continue;
    const g = groups.get(m[1]!) ?? { max: -1, width: 0, n: 0 };
    const v = Number(m[2]);
    g.n++;
    if (v > g.max) g.max = v;
    g.width = Math.max(g.width, m[2]!.length);
    groups.set(m[1]!, g);
  }
  let best: [string, { max: number; width: number; n: number }] | null = null;
  for (const e of groups) if (e[1].n >= 2 && (!best || e[1].n > best[1].n)) best = e;
  if (!best) return null;
  return `${best[0]}${String(best[1].max + 1).padStart(best[1].width, '0')}`;
}

/** Paths after a move / rename: each `from` (a note, or a folder and all inside it) becomes its `to`. */
export function movedPath(rel: string, moves: readonly { from: string; to: string }[]): string {
  for (const m of moves) {
    if (rel === m.from) return m.to;
    if (rel.startsWith(`${m.from}/`)) return m.to + rel.slice(m.from.length);
  }
  return rel;
}

/**
 * Sources of a project (same rule as the graph, T73): the sources inside its folder whose most specific project
 * is this one. Paths as stored (`~/…` or absolute).
 */
export function projectSourceIds(
  sources: readonly { id: string; path: string }[],
  projects: readonly { id: string; path: string }[],
  projectId: string | null | undefined,
): string[] {
  if (!projectId) return [];
  const inside = (child: string, parent: string) => {
    const p = parent.replace(/\/+$/, '');
    return child === p || child.startsWith(`${p}/`);
  };
  return sources
    .filter((s) => {
      const owner = projects
        .filter((p) => inside(s.path, p.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
      return owner?.id === projectId;
    })
    .map((s) => s.id);
}
