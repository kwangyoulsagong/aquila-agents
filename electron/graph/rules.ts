// Knowledge graph (T68): what the user decided about suggested connections, and the rules learned from it.
// Accepted pairs become solid, rejected pairs are never suggested again, and accepting the same pattern (a shared
// `DB-<n>` ID, a URL host) three times proposes a rule that makes every such connection solid. Kept in
// `~/.aquila/graph/links.json` — the user's files are only written when they ask for a `[[link]]` (`withLink`).
import fs from 'node:fs';
import path from 'node:path';
import type {
  GraphDecision,
  GraphEdge,
  GraphEdgeReason,
  GraphRule,
  GraphRuleOp,
  GraphRulePattern,
  GraphRuleProposal,
} from '../../src/shared/api/types';

/** Accepts of one pattern that propose a rule. */
export const PROPOSE_AFTER = 3;
/** v2 (T79): accepts recorded under an old short ID prefix (`id:REQ`) moved to the whole prefix (`id:FE-REQ`). */
const LINKS_VERSION = 2;

export interface AcceptedLink {
  a: string;
  b: string;
  /** Pattern keys the connection had when it was accepted (`id:DB`). */
  patterns: string[];
  at: number;
}

export interface LinkData {
  v: number;
  accepted: AcceptedLink[];
  /** Pair keys. */
  rejected: string[];
  rules: GraphRule[];
  /** Proposals answered "Not now". */
  dismissed: string[];
}

export const emptyLinks = (): LinkData => ({
  v: LINKS_VERSION,
  accepted: [],
  rejected: [],
  rules: [],
  dismissed: [],
});

export const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

export const patternKey = (p: GraphRulePattern) => (p.kind === 'id' ? `id:${p.prefix}` : `url:${p.host}`);

export function patternOfKey(key: string): GraphRulePattern | null {
  const m = /^(id|url):(.+)$/.exec(key);
  if (!m) return null;
  return m[1] === 'id' ? { kind: 'id', prefix: m[2] } : { kind: 'url', host: m[2] };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};
const idPrefix = (id: string) => id.slice(0, id.lastIndexOf('-'));

/** A pattern made from user input: `DB`, `DB-`, `DB-<n>` → id prefix; `github.com`, a URL → host. */
export function cleanPattern(p: GraphRulePattern): GraphRulePattern | null {
  if (p.kind === 'id') {
    const prefix = String(p.prefix ?? '')
      .trim()
      .toUpperCase()
      .replace(/-(<n>|\d+)?$/i, '');
    return /^[A-Z][A-Z0-9]+(?:-[A-Z][A-Z0-9]*)*$/.test(prefix) ? { kind: 'id', prefix } : null;
  }
  const raw = String(p.host ?? '').trim();
  const host = (/^https?:\/\//i.test(raw) ? hostOf(raw) : raw.toLowerCase().replace(/\/.*$/, '')) ?? '';
  return /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/.test(host) ? { kind: 'url', host } : null;
}

/** The patterns a reason stands for: a shared ID → its prefix, a shared URL → its host. */
function reasonPattern(r: GraphEdgeReason): GraphRulePattern | null {
  if (r.via === 'id' && r.label && r.label.includes('-')) return { kind: 'id', prefix: idPrefix(r.label) };
  if (r.via === 'url' && r.label) {
    const host = hostOf(r.label);
    return host ? { kind: 'url', host } : null;
  }
  return null;
}

export function patternsOf(edge: Pick<GraphEdge, 'reasons'>): GraphRulePattern[] {
  const out = new Map<string, GraphRulePattern>();
  for (const r of edge.reasons) {
    const p = reasonPattern(r);
    if (p) out.set(patternKey(p), p);
  }
  return [...out.values()];
}

/**
 * A rule's pattern covers `p`: the same pattern, or (T79) an ID prefix that ends in the rule's prefix at a segment
 * boundary. IDs used to be read without their leading segments (`FE-REQ-030` as `REQ-030`), so a rule learned
 * then (`REQ`) keeps covering `FE-REQ-<n>` and `SRV-REQ-<n>` now that IDs are read whole.
 */
export function covers(rule: GraphRulePattern, p: GraphRulePattern): boolean {
  if (rule.kind !== p.kind) return false;
  if (rule.kind === 'url' || p.kind === 'url') return patternKey(rule) === patternKey(p);
  return p.prefix === rule.prefix || p.prefix.endsWith(`-${rule.prefix}`);
}

/** The enabled rule a reason falls under, if any (its own pattern first, then one that covers it). */
export function ruleFor(r: GraphEdgeReason, rules: readonly GraphRule[]): GraphRule | undefined {
  const p = reasonPattern(r);
  if (!p) return undefined;
  const key = patternKey(p);
  const on = rules.filter((x) => x.enabled);
  return on.find((x) => patternKey(x.pattern) === key) ?? on.find((x) => covers(x.pattern, p));
}

/**
 * Patterns accepted PROPOSE_AFTER+ times that have no rule and weren't dismissed. An accept recorded under an old
 * short ID prefix (`id:REQ`, from when `FE-REQ-030` was read as `REQ-030`) counts toward every whole prefix of that
 * family that has accepts of its own (`id:FE-REQ`) — once per accept — and isn't proposed by itself then.
 */
export function proposals(data: LinkData): GraphRuleProposal[] {
  const keys = new Set(data.accepted.flatMap((a) => a.patterns));
  const family = (short: string) => {
    const p = patternOfKey(short);
    if (!p || p.kind !== 'id') return [];
    return [...keys].filter((k) => {
      const q = patternOfKey(k);
      return k !== short && !!q && covers(p, q);
    });
  };
  const wider = new Map([...keys].map((k) => [k, family(k)]));
  const count = new Map<string, number>();
  for (const a of data.accepted) {
    const counted = new Set<string>();
    for (const k of a.patterns) {
      const into = wider.get(k)?.length ? wider.get(k)! : [k];
      for (const x of into) counted.add(x);
    }
    for (const k of counted) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out: GraphRuleProposal[] = [];
  for (const [key, accepts] of count) {
    if (accepts < PROPOSE_AFTER || data.dismissed.includes(key)) continue;
    const pattern = patternOfKey(key);
    if (pattern && !data.rules.some((r) => covers(r.pattern, pattern))) out.push({ key, pattern, accepts });
  }
  return out.sort((x, y) => y.accepts - x.accepts || x.key.localeCompare(y.key));
}

/**
 * v1 → v2 (T79): a short ID key (`id:REQ`) whose family has exactly one whole prefix among the accepts
 * (`id:FE-REQ`) becomes that key, in accepts and "Not now" answers. Ambiguous ones (`FE-REQ` and `SRV-REQ`) stay
 * short and still count toward each (see `proposals`). Pure; the result has the current version.
 */
export function migrateLinks(data: LinkData): LinkData {
  const keys = new Set(data.accepted.flatMap((a) => a.patterns));
  const to = new Map<string, string>();
  for (const k of keys) {
    const p = patternOfKey(k);
    if (!p || p.kind !== 'id' || p.prefix.includes('-')) continue;
    const wide = [...keys].filter((x) => {
      const q = patternOfKey(x);
      return x !== k && !!q && covers(p, q);
    });
    if (wide.length === 1) to.set(k, wide[0]!);
  }
  const map = (k: string) => to.get(k) ?? k;
  return {
    ...data,
    v: LINKS_VERSION,
    accepted: data.accepted.map((a) => ({ ...a, patterns: [...new Set(a.patterns.map(map))] })),
    dismissed: [...new Set(data.dismissed.map(map))],
  };
}

/** Records a decision. `edge` is the connection as the graph shows it (for its patterns). */
export function decide(data: LinkData, d: GraphDecision, edge: GraphEdge | undefined, now: number): LinkData {
  const key = pairKey(d.source, d.target);
  const accepted = data.accepted.filter((a) => pairKey(a.a, a.b) !== key);
  const rejected = data.rejected.filter((k) => k !== key);
  if (d.accept) {
    accepted.push({
      a: d.source,
      b: d.target,
      patterns: edge ? patternsOf(edge).map(patternKey) : [],
      at: now,
    });
  } else rejected.push(key);
  return { ...data, accepted, rejected };
}

let seq = 0;
const ruleId = (now: number) => `r${now.toString(36)}${(seq++).toString(36)}`;

/** Applies a rule edit. Unknown ids and patterns that don't clean up are ignored. */
export function applyRuleOp(data: LinkData, op: GraphRuleOp, now: number): LinkData {
  if (op.op === 'dismiss')
    return data.dismissed.includes(op.key) ? data : { ...data, dismissed: [...data.dismissed, op.key] };
  if (op.op === 'remove') return { ...data, rules: data.rules.filter((r) => r.id !== op.id) };
  if (op.op === 'add') {
    const pattern = cleanPattern(op.pattern);
    if (!pattern || data.rules.some((r) => patternKey(r.pattern) === patternKey(pattern))) return data;
    return { ...data, rules: [...data.rules, { id: ruleId(now), pattern, enabled: true, createdAt: now }] };
  }
  const pattern = cleanPattern(op.rule.pattern);
  if (!pattern) return data;
  const clash = data.rules.some((r) => r.id !== op.rule.id && patternKey(r.pattern) === patternKey(pattern));
  if (clash) return data;
  return {
    ...data,
    rules: data.rules.map((r) => (r.id === op.rule.id ? { ...r, pattern, enabled: !!op.rule.enabled } : r)),
  };
}

export function readLinks(file: string | undefined): LinkData {
  if (!file) return emptyLinks();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LinkData>;
    if (raw.v !== LINKS_VERSION && raw.v !== 1) return emptyLinks();
    const strings = (x: unknown) =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
    const data: LinkData = {
      v: LINKS_VERSION,
      accepted: Array.isArray(raw.accepted)
        ? raw.accepted
            .filter((a) => a && typeof a.a === 'string' && typeof a.b === 'string')
            .map((a) => ({ ...a, patterns: strings(a.patterns) }))
        : [],
      rejected: strings(raw.rejected),
      rules: Array.isArray(raw.rules)
        ? raw.rules.filter((r) => r && typeof r.id === 'string' && cleanPattern(r.pattern))
        : [],
      dismissed: strings(raw.dismissed),
    };
    return raw.v === 1 ? migrateLinks(data) : data;
  } catch {
    return emptyLinks();
  }
}

export function writeLinks(file: string, data: LinkData): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** A name that can stand inside `[[…]]`. */
export const linkable = (name: string) => /^[^[\]|#\r\n]{1,200}$/.test(name) && name.trim() === name;

/**
 * The note's text with `[[name]]` on a new last line, in the file's own line ending; null when it already has that
 * link. Only the end changes, so every existing byte stays as it was.
 */
export function withLink(text: string, name: string): string | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\[\\[\\s*${esc}\\s*(?:[#|][^\\]]*)?\\]\\]`, 'i').test(text)) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const sep = !text.length || text.endsWith('\n') ? '' : eol;
  return `${text}${sep}[[${name}]]${eol}`;
}
