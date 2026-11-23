// Knowledge graph (T65): parsed notes + project code names → nodes and edges. Pure: runs in the index worker.
import path from 'node:path';
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphEdgeReason,
  GraphIdGroup,
  GraphNode,
  GraphSnapshot,
} from '../../src/shared/api/types';
import type { ParsedNote } from './parse';

export interface IndexedNote {
  sourceId: string;
  /** Path inside the source, `/`-separated. */
  rel: string;
  /** Absolute path. */
  abs: string;
  mtime: number;
  size: number;
  note: ParsedNote;
}

/** A code name (`useWorkspace`, `apply.ts`) and where it was found. */
export interface CodeName {
  path: string;
  projects: string[];
}

export const noteId = (sourceId: string, rel: string) => `note:${sourceId}:${rel}`;

/** Edge strength per reason. Kind follows from the reason. */
const STRENGTH: Record<GraphEdgeReason['via'], number> = {
  link: 1,
  frontmatter: 0.9,
  tag: 0.8,
  session: 1,
  changed: 1,
  id: 0.7,
  title: 0.6,
  code: 0.5,
  url: 0.4,
  rule: 0.9,
  similar: 0.3,
  ai: 0.3,
};
const KIND: Record<GraphEdgeReason['via'], GraphEdgeKind> = {
  link: 'explicit',
  frontmatter: 'explicit',
  tag: 'explicit',
  rule: 'explicit',
  session: 'action',
  changed: 'action',
  id: 'mention',
  title: 'mention',
  code: 'mention',
  url: 'mention',
  similar: 'suggested',
  ai: 'suggested',
};
const SYMMETRIC = new Set<GraphEdgeReason['via']>(['id', 'url', 'similar']);
const RANK: Record<GraphEdgeKind, number> = { explicit: 3, action: 2, mention: 1, suggested: 0 };

/** A shared ID / URL in more notes than this is noise (a template footer), not a connection. */
const MAX_SHARED = 20;
/** Titles that are file-name defaults, not names. */
const GENERIC_TITLES = new Set([
  'readme',
  'index',
  'todo',
  'notes',
  'note',
  'untitled',
  'changelog',
  'license',
  'contributing',
  'agents',
  'claude',
  '메모',
  '노트',
]);
const TOKEN = /[\p{L}\p{N}_]+/gu;
// eslint-disable-next-line no-control-regex -- the whole ASCII range on purpose
const ASCII = /^[\x00-\x7f]*$/;

const stripMd = (s: string) => s.replace(/\.md$/i, '');
const nameOf = (rel: string) => stripMd(path.posix.basename(rel)).toLowerCase();

/** A title long enough to be found in text without matching everything. */
function mentionable(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (GENERIC_TITLES.has(t)) return false;
  return ASCII.test(t) ? t.length >= 4 : t.length >= 3;
}

/** Token keys of a text: whole tokens, and the first two letters of non-ASCII tokens (Korean particles attach). */
function tokenKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    keys.add(t);
    if (!ASCII.test(t) && t.length > 2) keys.add(t.slice(0, 2));
  }
  return keys;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** `title` in `text` (both lowercased); ASCII titles only as whole words. */
function contains(text: string, title: string): boolean {
  if (!ASCII.test(title)) return text.includes(title);
  let i = text.indexOf(title);
  while (i >= 0) {
    if (!isWordChar(text[i - 1]) && !isWordChar(text[i + title.length])) return true;
    i = text.indexOf(title, i + 1);
  }
  return false;
}

class EdgeSet {
  private map = new Map<string, GraphEdge>();

  add(source: string, target: string, reason: GraphEdgeReason): void {
    if (source === target) return;
    const kind = KIND[reason.via];
    // A shared ID / URL or a similarity has no direction; a link or a mention goes from the note that wrote it.
    const directed = !SYMMETRIC.has(reason.via);
    const [a, b] = source < target ? [source, target] : [target, source];
    const key = `${a}\u0000${b}`;
    const prev = this.map.get(key);
    if (!prev) {
      const [s, t] = directed ? [source, target] : [a, b];
      this.map.set(key, {
        id: `${s}→${t}`,
        source: s,
        target: t,
        kind,
        strength: STRENGTH[reason.via],
        reasons: [reason],
      });
      return;
    }
    // Direction: from the strongest directed reason; an edge with only symmetric reasons takes the first directed one.
    const wasSymmetric = prev.reasons.every((r) => SYMMETRIC.has(r.via));
    const stronger = RANK[kind] > RANK[prev.kind];
    if (directed && (stronger || wasSymmetric)) {
      prev.source = source;
      prev.target = target;
      prev.id = `${source}→${target}`;
    }
    if (stronger) prev.kind = kind;
    if (!prev.reasons.some((r) => r.via === reason.via && r.label === reason.label)) prev.reasons.push(reason);
    prev.strength = Math.max(prev.strength, STRENGTH[reason.via]);
  }

  values(): GraphEdge[] {
    return [...this.map.values()];
  }
}

/** Notes in 2..MAX_SHARED notes per key → pairwise mention edges. */
function shared(edges: EdgeSet, byKey: Map<string, string[]>, via: 'id' | 'url'): void {
  for (const [key, ids] of byKey) {
    if (ids.length < 2 || ids.length > MAX_SHARED) continue;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) edges.add(ids[i], ids[j], { via, label: key });
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else map.set(key, [value]);
}

export function buildGraph(
  notes: Iterable<IndexedNote>,
  codeNames: ReadonlyMap<string, CodeName>,
  version = 0,
): GraphSnapshot {
  const all = [...notes].sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0));
  const nodes = new Map<string, GraphNode>();
  const edges = new EdgeSet();

  // Lookups for resolving `[[Name]]`, `folder/Name`, relative links and frontmatter values.
  const byName = new Map<string, IndexedNote[]>();
  const byTitle = new Map<string, IndexedNote[]>();
  const byPath = new Map<string, IndexedNote>();
  for (const n of all) {
    const id = noteId(n.sourceId, n.rel);
    nodes.set(id, {
      id,
      kind: 'note',
      label: n.note.title,
      sourceId: n.sourceId,
      path: n.abs,
      mtime: n.mtime,
      ...(n.note.tags.length ? { tags: n.note.tags } : {}),
    });
    push(byName, nameOf(n.rel), n);
    push(byTitle, n.note.title.trim().toLowerCase(), n);
    byPath.set(`${n.sourceId}:${n.rel.toLowerCase()}`, n);
  }
  const pick = (list: IndexedNote[] | undefined, from: IndexedNote) =>
    list?.find((n) => n.sourceId === from.sourceId) ?? list?.[0];

  const resolve = (target: string, from: IndexedNote): IndexedNote | undefined => {
    const t = stripMd(target.trim()).toLowerCase();
    if (!t) return from;
    if (t.includes('/')) {
      const suffix = `/${t.replace(/^\/+/, '')}.md`;
      const inSource = all.filter((n) => `/${n.rel.toLowerCase()}`.endsWith(suffix));
      return inSource.find((n) => n.sourceId === from.sourceId) ?? inSource[0];
    }
    return pick(byName.get(t), from) ?? pick(byTitle.get(t), from);
  };

  for (const n of all) {
    const from = noteId(n.sourceId, n.rel);
    for (const l of n.note.wikiLinks) {
      const to = resolve(l.target, n);
      if (to) {
        edges.add(from, noteId(to.sourceId, to.rel), {
          via: 'link',
          ...(l.heading ? { label: l.heading } : {}),
        });
        continue;
      }
      const name = path.posix.basename(l.target);
      const missing = `missing:${name.toLowerCase()}`;
      if (!nodes.has(missing)) nodes.set(missing, { id: missing, kind: 'missing', label: name });
      edges.add(from, missing, { via: 'link' });
    }
    for (const rel of n.note.mdLinks) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(n.rel), rel));
      const to = byPath.get(`${n.sourceId}:${target.toLowerCase()}`);
      if (to) edges.add(from, noteId(to.sourceId, to.rel), { via: 'link' });
    }
    for (const tag of n.note.tags) {
      const id = `tag:${tag.toLowerCase()}`;
      if (!nodes.has(id)) nodes.set(id, { id, kind: 'tag', label: `#${tag}` });
      edges.add(from, id, { via: 'tag' });
    }
    for (const ref of n.note.frontmatterRefs) {
      const t = ref.value.trim().toLowerCase();
      const to = pick(byName.get(t), n) ?? pick(byTitle.get(t), n);
      if (to) edges.add(from, noteId(to.sourceId, to.rel), { via: 'frontmatter', label: ref.key });
    }
    for (const ident of n.note.idents) {
      const code = codeNames.get(ident);
      if (!code) continue;
      const id = `code:${ident}`;
      if (!nodes.has(id))
        nodes.set(id, { id, kind: 'code', label: ident, path: code.path, projects: code.projects });
      edges.add(from, id, { via: 'code', label: ident });
    }
  }

  // Another note's title in the text. Candidates come from a token index, then the text is checked.
  const keys = new Map<string, IndexedNote[]>();
  for (const n of all) for (const k of tokenKeys(n.note.text)) push(keys, k, n);
  for (const target of all) {
    const title = target.note.title.trim().toLowerCase();
    if (!mentionable(title)) continue;
    const first = title.match(TOKEN)?.[0];
    if (!first) continue;
    const key = ASCII.test(first) || first.length <= 2 ? first : first.slice(0, 2);
    const to = noteId(target.sourceId, target.rel);
    for (const n of keys.get(key) ?? []) {
      if (n === target || !contains(n.note.text, title)) continue;
      edges.add(noteId(n.sourceId, n.rel), to, { via: 'title', label: target.note.title });
    }
  }

  // A repeated ID or a shared URL.
  const byId = new Map<string, string[]>();
  const byUrl = new Map<string, string[]>();
  for (const n of all) {
    const id = noteId(n.sourceId, n.rel);
    for (const x of n.note.ids) push(byId, x, id);
    for (const u of n.note.urls) push(byUrl, u, id);
  }
  shared(edges, byId, 'id');
  shared(edges, byUrl, 'url');

  return { nodes: [...nodes.values()], edges: edges.values(), idGroups: idGroups(byId), version };
}

/** IDs seen in 2+ notes, grouped by prefix: "looks like an ID". */
export function idGroups(byId: ReadonlyMap<string, string[]>): GraphIdGroup[] {
  const groups = new Map<string, { ids: [string, number][]; notes: Set<string> }>();
  for (const [id, notes] of byId) {
    if (notes.length < 2) continue;
    const prefix = id.slice(0, id.lastIndexOf('-'));
    const g = groups.get(prefix) ?? { ids: [], notes: new Set<string>() };
    g.ids.push([id, notes.length]);
    for (const n of notes) g.notes.add(n);
    groups.set(prefix, g);
  }
  return [...groups.entries()]
    .map(([prefix, g]) => ({
      prefix,
      ids: g.ids
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 20)
        .map(([id]) => id),
      notes: g.notes.size,
    }))
    .sort((a, b) => b.notes - a.notes || a.prefix.localeCompare(b.prefix));
}
