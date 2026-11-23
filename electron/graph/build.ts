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
import type { AiExtract } from './extract';
import type { ParsedNote } from './parse';
import { pairKey, ruleFor, type LinkData } from './rules';
import type { SimilarPair } from './similar';
import { matchesOf, nameKeys, type CompiledLinkRule } from './vault';

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
  accepted: 0.9,
  similar: 0.3,
  ai: 0.3,
};
const KIND: Record<GraphEdgeReason['via'], GraphEdgeKind> = {
  link: 'explicit',
  frontmatter: 'explicit',
  tag: 'explicit',
  rule: 'explicit',
  accepted: 'explicit',
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

/** T68 additions: suggestions (local similarity, AI) and the user's decisions / rules. */
export interface BuildExtras {
  similar?: readonly SimilarPair[];
  ai?: ReadonlyMap<string, AiExtract>;
  links?: Pick<LinkData, 'accepted' | 'rejected' | 'rules'>;
  /** T69: each source's link rules (pattern → note by name / property). */
  vaultLinks?: ReadonlyMap<string, readonly CompiledLinkRule[]>;
}

/** Similarity 0–1 → a suggested edge's strength (always under a mention's 0.4). */
export const similarStrength = (score: number) => Math.round((0.1 + 0.25 * Math.min(1, score)) * 100) / 100;

class EdgeSet {
  private map = new Map<string, GraphEdge>();

  has(a: string, b: string): boolean {
    return this.map.has(pairKey(a, b));
  }

  get(key: string): GraphEdge | undefined {
    return this.map.get(key);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  add(source: string, target: string, reason: GraphEdgeReason, strength = STRENGTH[reason.via]): void {
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
        strength,
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
    prev.strength = Math.max(prev.strength, strength);
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
  extras: BuildExtras = {},
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
  if (extras.vaultLinks?.size) addVaultLinks(all, edges, extras.vaultLinks);
  addSuggestions(nodes, edges, extras);
  applyDecisions(nodes, edges, extras.links);

  return { nodes: [...nodes.values()], edges: edges.values(), idGroups: idGroups(byId), version };
}

/**
 * T69: a source's link rules. Text matching a rule (case-insensitive, in the lowercased body) links to the note of
 * the same source named by the match (`DB-12` → `DB-12-login.md`) or whose property has that value — explicit.
 */
function addVaultLinks(
  all: readonly IndexedNote[],
  edges: EdgeSet,
  rules: ReadonlyMap<string, readonly CompiledLinkRule[]>,
): void {
  for (const [sourceId, list] of rules) {
    const notes = all.filter((n) => n.sourceId === sourceId);
    let names: Map<string, IndexedNote[]> | null = null;
    const props = new Map<string, Map<string, IndexedNote[]>>();
    const byName = () => {
      if (!names) {
        names = new Map();
        for (const n of notes) for (const k of nameKeys(n.rel)) push(names, k, n);
      }
      return names;
    };
    const byProp = (key: string) => {
      let m = props.get(key);
      if (!m) {
        m = new Map();
        for (const n of notes) {
          const v = n.note.frontmatter[key];
          for (const x of Array.isArray(v) ? v : v ? [v] : []) push(m, x.trim().toLowerCase(), n);
        }
        props.set(key, m);
      }
      return m;
    };
    for (const n of notes) {
      const from = noteId(n.sourceId, n.rel);
      for (const r of list)
        for (const m of matchesOf(r.re, n.note.text, 50)) {
          const hits = r.to === 'name' ? byName().get(m) : byProp(r.key ?? '').get(m);
          for (const to of (hits ?? []).slice(0, 5)) edges.add(from, noteId(to.sourceId, to.rel), { via: 'rule', label: m });
        }
    }
  }
}

const AI_KINDS = new Set<GraphNode['kind']>(['person', 'decision', 'todo']);

/** Local similarity and AI extracts → suggested edges (only where nothing connects the two yet) and AI nodes. */
function addSuggestions(nodes: Map<string, GraphNode>, edges: EdgeSet, extras: BuildExtras): void {
  for (const p of extras.similar ?? []) {
    if (!nodes.has(p.a) || !nodes.has(p.b) || edges.has(p.a, p.b)) continue;
    edges.add(p.a, p.b, { via: 'similar', label: p.terms.join(', ') }, similarStrength(p.score));
  }
  for (const [from, x] of extras.ai ?? []) {
    if (nodes.get(from)?.kind !== 'note') continue;
    const item = (kind: 'person' | 'decision' | 'todo', label: string, id: string) => {
      if (!nodes.has(id)) nodes.set(id, { id, kind, label });
      edges.add(from, id, { via: 'ai', label: kind });
    };
    for (const name of x.people) item('person', name, `person:${name.toLowerCase()}`);
    // Decisions and to-dos belong to the note that has them.
    for (const d of x.decisions) item('decision', d, `decision:${from}:${d.toLowerCase()}`);
    for (const t of x.todos) item('todo', t, `todo:${from}:${t.toLowerCase()}`);
    for (const to of x.related) if (nodes.has(to) && !edges.has(from, to)) edges.add(from, to, { via: 'ai' });
  }
}

/**
 * The user's decisions: an enabled rule makes the connections it covers explicit, accepted pairs become explicit,
 * rejected pairs disappear unless something written connects them. AI nodes left with no edge go too.
 */
function applyDecisions(nodes: Map<string, GraphNode>, edges: EdgeSet, links: BuildExtras['links']): void {
  if (!links) return;
  if (links.rules.length)
    for (const e of edges.values()) {
      for (const r of e.reasons) {
        const rule = ruleFor(r, links.rules);
        if (!rule) continue;
        const label = rule.pattern.kind === 'id' ? `${rule.pattern.prefix}-<n>` : rule.pattern.host;
        edges.add(e.source, e.target, { via: 'rule', label });
        break;
      }
    }
  for (const a of links.accepted)
    if (nodes.has(a.a) && nodes.has(a.b)) edges.add(a.a, a.b, { via: 'accepted' });
  for (const key of links.rejected) {
    const e = edges.get(key);
    if (e && RANK[e.kind] < RANK.action) edges.delete(key);
  }
  const linked = new Set<string>();
  for (const e of edges.values()) linked.add(e.source).add(e.target);
  for (const [id, n] of nodes) if (AI_KINDS.has(n.kind) && !linked.has(id)) nodes.delete(id);
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
