import type { GraphNode, GraphSnapshot } from '@/shared/api';

// What the editor shows beside a note, read from the graph index (T65): its outline, the notes that link to it
// (backlinks) and the ones that name it without a link (unlinked mentions); plus `[[link]]` resolution and
// completion over the same notes.

export interface Heading {
  level: number;
  text: string;
  /** 1-based line number. */
  line: number;
}

/** ATX headings (`# …`), skipping frontmatter and fenced code. */
export function outline(text: string): Heading[] {
  const out: Heading[] = [];
  const lines = text.split(/\r\n?|\n/);
  let fence: string | null = null;
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h && h[2]) out.push({ level: h[1]!.length, text: h[2], line: i + 1 });
  }
  return out;
}

export interface LinkedNote {
  id: string;
  label: string;
  path: string;
  /** Why it's listed: the heading / title the link or mention used. */
  detail?: string;
}

const noteNode = (snap: GraphSnapshot, id: string) => {
  const n = snap.nodes.find((x) => x.id === id);
  return n?.kind === 'note' && n.path ? n : undefined;
};

/** The graph node of a note file. */
export const nodeOfPath = (snap: GraphSnapshot | null, path: string): GraphNode | undefined =>
  snap?.nodes.find((n) => n.kind === 'note' && n.path === path);

/** Notes that link to `id` (written links, frontmatter references) and those that name it without one. */
export function linksTo(
  snap: GraphSnapshot | null,
  id: string | undefined,
): { backlinks: LinkedNote[]; mentions: LinkedNote[] } {
  const backlinks: LinkedNote[] = [];
  const mentions: LinkedNote[] = [];
  if (!snap || !id) return { backlinks, mentions };
  for (const e of snap.edges) {
    if (e.target !== id || e.source === id) continue;
    const from = noteNode(snap, e.source);
    if (!from) continue;
    const item = { id: from.id, label: from.label, path: from.path! };
    const link = e.reasons.find((r) => r.via === 'link' || r.via === 'frontmatter');
    if (link) backlinks.push(link.label ? { ...item, detail: link.label } : item);
    else if (e.reasons.some((r) => r.via === 'title')) mentions.push(item);
  }
  const byLabel = (a: LinkedNote, b: LinkedNote) => a.label.localeCompare(b.label);
  return { backlinks: backlinks.sort(byLabel), mentions: mentions.sort(byLabel) };
}

const baseName = (p: string) => (p.split(/[/\\]/).pop() ?? p).replace(/\.md$/i, '').trim().toLowerCase();

/**
 * The note a `[[target]]` points at, the way the index resolves it: a path suffix when it has `/`, else the file
 * name, else the title; a note in the same source wins.
 */
export function resolveLink(
  snap: GraphSnapshot | null,
  target: string,
  fromSource?: string,
): GraphNode | undefined {
  if (!snap) return undefined;
  const t = target.split('#')[0]!.split('|')[0]!.trim().replace(/\.md$/i, '').toLowerCase();
  if (!t) return undefined;
  const notes = snap.nodes.filter((n) => n.kind === 'note' && n.path);
  const pick = (list: GraphNode[]) => list.find((n) => n.sourceId === fromSource) ?? list[0];
  if (t.includes('/')) {
    const suffix = `/${t.replace(/^\/+/, '')}.md`;
    return pick(notes.filter((n) => n.path!.replace(/\\/g, '/').toLowerCase().endsWith(suffix)));
  }
  return (
    pick(notes.filter((n) => baseName(n.path!) === t)) ??
    pick(notes.filter((n) => n.label.trim().toLowerCase() === t))
  );
}

export interface LinkOption {
  /** What goes between `[[` and `]]`: the file name, which the index resolves first. */
  insert: string;
  label: string;
  detail?: string;
}

/** `[[` completion: every note, by title, inserting its file name. */
export function linkOptions(snap: GraphSnapshot | null, exceptPath?: string): LinkOption[] {
  if (!snap) return [];
  return snap.nodes
    .filter((n) => n.kind === 'note' && n.path && n.path !== exceptPath)
    .map((n) => {
      const insert = (n.path!.split(/[/\\]/).pop() ?? n.label).replace(/\.md$/i, '');
      return insert === n.label ? { insert, label: n.label } : { insert, label: n.label, detail: insert };
    });
}
