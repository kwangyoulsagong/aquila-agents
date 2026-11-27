// T81 "What is this?": notes related to a text that isn't a note (a pasted guide, an email, a Figma link), from the
// local index only — no model. Two reasons, shown as they are: the same ticket / requirement ID, and shared weighty
// words (the similarity index's lookup). Pure ranking here; the engine (worker) supplies the notes and the lookup.
import type { RelatedNote } from '../../src/shared/api/types';

export interface RelatedCandidate {
  id: string;
  abs: string;
  title: string;
  rel: string;
  sourceId: string;
  /** IDs found in the note (`parseNote().ids`). */
  ids: readonly string[];
}

export interface SimilarHit {
  id: string;
  score: number;
  terms: string[];
}

const MAX_IDS = 30;
/** An ID-like token from the model's `terms` (`FE-REQ-030`, `DB-12`). */
const ID_LIKE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/;

/** IDs the model named, cleaned (uppercase, ID-shaped, ≤ 30) — they only add lookups, never a note of their own. */
export function cleanIds(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const x of list) {
    if (typeof x !== 'string') continue;
    const id = x.trim().toUpperCase();
    if (id.length <= 40 && ID_LIKE.test(id)) out.add(id);
    if (out.size >= MAX_IDS) break;
  }
  return [...out];
}

const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Notes for a text: those that carry one of its IDs first (a note *named* by the ID — `FE-REQ-030.md` — before one
 * that only mentions it), then the nearest by shared words. One entry per note with every reason it has.
 */
export function rankRelated(
  ids: readonly string[],
  similar: readonly SimilarHit[],
  notes: Iterable<RelatedCandidate>,
  k = 6,
): RelatedNote[] {
  const wanted = [...new Set(ids.map((x) => x.toUpperCase()))].slice(0, MAX_IDS);
  const byId = new Map<
    string,
    { c: RelatedCandidate; ids: string[]; named: number; score: number; words: string[] }
  >();
  const sim = new Map(similar.map((s) => [s.id, s]));
  const named = wanted.map((id) => ({ id, re: new RegExp(`(^|[^A-Z0-9])${escape(id)}($|[^A-Z0-9])`, 'i') }));
  for (const c of notes) {
    const own = new Set(c.ids.map((x) => x.toUpperCase()));
    const hit: string[] = [];
    let name = 0;
    for (const { id, re } of named) {
      const inName = re.test(c.title) || re.test(baseName(c.rel));
      if (inName) name++;
      if (inName || own.has(id)) hit.push(id);
    }
    const s = sim.get(c.id);
    if (!hit.length && !s) continue;
    byId.set(c.id, { c, ids: hit, named: name, score: s?.score ?? 0, words: s?.terms ?? [] });
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        b.named - a.named ||
        b.ids.length - a.ids.length ||
        b.score - a.score ||
        a.c.title.localeCompare(b.c.title),
    )
    .slice(0, k)
    .map((x) => ({
      path: x.c.abs,
      title: x.c.title,
      sourceId: x.c.sourceId,
      ids: x.ids,
      words: x.words,
      score: Math.round((x.ids.length + x.score) * 100) / 100,
    }));
}
