import type { GraphEdge, GraphNode } from '@/shared/api';

// Requirement IDs (T79): which note defines an ID, who mentions it, and what work (sessions, changed files) touched
// it — all from the index snapshot (notes carry `refIds` / `fmId` / `status`). Nothing about one repo's ID format
// is built in: an ID is `PREFIX-<n>` (prefix segments allowed: `FE-REQ-030`), and a prefix counts once the index
// has seen it defined by a note, or used for 2+ IDs / in 2+ notes.

/** An ID with its whole prefix. Same shape as the index's `REF_ID` (electron/graph/parse.ts). */
export const ID_RE = /\b[A-Z][A-Z0-9]+(?:-[A-Z][A-Z0-9]*)*-\d+\b/g;
const LEADING_ID = /^([A-Z][A-Z0-9]+(?:-[A-Z][A-Z0-9]*)*-\d+)(?![A-Za-z0-9])/;

export const idPrefix = (id: string) => id.slice(0, id.lastIndexOf('-'));

/**
 * `defined`: one note defines it · `duplicate`: 2+ notes do · `unknown`: none does, though notes define IDs of its
 * prefix (a typo, a deleted spec) · `loose`: a prefix the index knows but nobody defines (tickets, references).
 */
export type IdState = 'defined' | 'duplicate' | 'unknown' | 'loose';

export interface IdInfo {
  id: string;
  state: IdState;
  /** The notes that define it (frontmatter `id:`, or a file name / title starting with it). */
  defs: GraphNode[];
  /** Notes that mention it, not counting its definitions. */
  notes: GraphNode[];
  /** Sessions that worked on it: touched a defining note, or have the ID in their title. */
  sessions: GraphNode[];
  /** Files those sessions changed. */
  files: GraphNode[];
}

export interface IdIndex {
  /** ID → defining notes. */
  defs: Map<string, GraphNode[]>;
  /** ID → notes mentioning it (definitions included). */
  refs: Map<string, GraphNode[]>;
  /** Prefixes some note defines an ID of. */
  defined: Set<string>;
  /** Prefixes worth marking in text: defined ones, plus those seen for 2+ IDs or in 2+ notes. */
  known: Set<string>;
  /** Everything about one ID (memoized per index). */
  info(id: string): IdInfo;
  /** The IDs a note defines. */
  definedBy(noteId: string): string[];
}

const fileName = (p: string) => (p.split(/[/\\]/).pop() ?? p).replace(/\.md$/i, '');

/** The IDs a note defines: its frontmatter `id:` (when it is an ID), file name and title starting with one. */
export function definesOf(n: GraphNode): string[] {
  if (n.kind !== 'note') return [];
  const out = new Set<string>();
  const fm = n.fmId ? LEADING_ID.exec(n.fmId.trim()) : null;
  if (fm) out.add(fm[1]!);
  for (const s of [n.path ? fileName(n.path) : '', n.label]) {
    const m = LEADING_ID.exec(s.trim());
    if (m) out.add(m[1]!);
  }
  return [...out];
}

function push<V>(map: Map<string, V[]>, key: string, v: V): void {
  const l = map.get(key);
  if (!l) map.set(key, [v]);
  else if (!l.includes(v)) l.push(v);
}

const cache = new WeakMap<object, IdIndex>();

/**
 * One pass over the nodes and edges (O(n)); memoized per `nodes` array, so every caller of the same snapshot (or
 * filtered view) shares one index.
 */
export function idIndex(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): IdIndex {
  const hit = cache.get(nodes);
  if (hit) return hit;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const defs = new Map<string, GraphNode[]>();
  const refs = new Map<string, GraphNode[]>();
  const defsByNote = new Map<string, string[]>();
  const sessionsByTitle = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind === 'note') {
      const own = definesOf(n);
      if (own.length) defsByNote.set(n.id, own);
      for (const id of own) push(defs, id, n);
      for (const id of n.refIds ?? []) push(refs, id, n);
    } else if (n.kind === 'session') {
      for (const m of n.label.matchAll(ID_RE)) push(sessionsByTitle, m[0], n);
    }
  }
  // Note → sessions next to it; session → files it changed.
  const sessionsOf = new Map<string, GraphNode[]>();
  const filesOf = new Map<string, GraphNode[]>();
  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    if (a.kind === 'note' && b.kind === 'session') push(sessionsOf, a.id, b);
    else if (b.kind === 'note' && a.kind === 'session') push(sessionsOf, b.id, a);
    else if (a.kind === 'session' && b.kind === 'file') push(filesOf, a.id, b);
    else if (b.kind === 'session' && a.kind === 'file') push(filesOf, b.id, a);
  }

  const defined = new Set<string>();
  for (const id of defs.keys()) defined.add(idPrefix(id));
  const known = new Set(defined);
  const perPrefix = new Map<string, number>();
  for (const [id, list] of refs) {
    const p = idPrefix(id);
    const c = (perPrefix.get(p) ?? 0) + 1;
    perPrefix.set(p, c);
    if (c >= 2 || list.length >= 2) known.add(p);
  }

  const infos = new Map<string, IdInfo>();
  const index: IdIndex = {
    defs,
    refs,
    defined,
    known,
    definedBy: (noteId) => defsByNote.get(noteId) ?? [],
    info(id) {
      const kept = infos.get(id);
      if (kept) return kept;
      const d = defs.get(id) ?? [];
      const notes = (refs.get(id) ?? []).filter((n) => !d.includes(n));
      const sessions = new Set<GraphNode>(sessionsByTitle.get(id) ?? []);
      for (const n of d) for (const s of sessionsOf.get(n.id) ?? []) sessions.add(s);
      const files = new Set<GraphNode>();
      for (const s of sessions) for (const f of filesOf.get(s.id) ?? []) files.add(f);
      const state: IdState =
        d.length > 1 ? 'duplicate' : d.length ? 'defined' : defined.has(idPrefix(id)) ? 'unknown' : 'loose';
      const out = { id, state, defs: d, notes, sessions: [...sessions], files: [...files] };
      infos.set(id, out);
      return out;
    },
  };
  cache.set(nodes, index);
  return index;
}

/** Whether an ID in text is worth marking: its prefix is one the index knows. */
export const markable = (ix: IdIndex, id: string) => ix.known.has(idPrefix(id));

/** `- [x]` / `- [ ]` task items of a note (fenced code skipped): done and total. */
export function checklist(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  let fence: string | null = null;
  for (const l of text.split(/\r\n?|\n/)) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(l);
    if (!m) continue;
    total++;
    if (m[1] !== ' ') done++;
  }
  return { done, total };
}

/** Requirement notes no session or changed file has touched (map lens): defining notes of IDs with no work. */
export function idsWithNoWork(ix: IdIndex): Set<string> {
  const out = new Set<string>();
  for (const [id, list] of ix.defs) {
    const info = ix.info(id);
    if (info.sessions.length === 0) for (const n of list) out.add(n.id);
  }
  return out;
}

/** Notes with an ID problem (map lens): every definition of a duplicate, and notes naming an unknown ID. */
export function idIssues(ix: IdIndex): Set<string> {
  const out = new Set<string>();
  for (const list of ix.defs.values()) if (list.length > 1) for (const n of list) out.add(n.id);
  for (const [id, list] of ix.refs)
    if (!ix.defs.has(id) && ix.defined.has(idPrefix(id))) for (const n of list) out.add(n.id);
  return out;
}

export interface ReferencedIn {
  /** The IDs the note defines. */
  ids: string[];
  notes: GraphNode[];
  sessions: GraphNode[];
  files: GraphNode[];
  /** Other notes that define one of the same IDs. */
  duplicates: GraphNode[];
}

/** The editor's "Referenced in" for one note: its own IDs' mentions, sessions and changed files, merged. */
export function referencedIn(ix: IdIndex, noteId: string): ReferencedIn {
  const ids = ix.definedBy(noteId);
  const notes = new Set<GraphNode>();
  const sessions = new Set<GraphNode>();
  const files = new Set<GraphNode>();
  const duplicates = new Set<GraphNode>();
  for (const id of ids) {
    const i = ix.info(id);
    for (const n of i.notes) if (n.id !== noteId) notes.add(n);
    for (const s of i.sessions) sessions.add(s);
    for (const f of i.files) files.add(f);
    for (const d of i.defs) if (d.id !== noteId) duplicates.add(d);
  }
  const byLabel = (a: GraphNode, b: GraphNode) => a.label.localeCompare(b.label);
  const recent = (a: GraphNode, b: GraphNode) => (b.mtime ?? 0) - (a.mtime ?? 0);
  return {
    ids,
    notes: [...notes].sort(byLabel),
    sessions: [...sessions].sort(recent),
    files: [...files].sort(byLabel),
    duplicates: [...duplicates].sort(byLabel),
  };
}
