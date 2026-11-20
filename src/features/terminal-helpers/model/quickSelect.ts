// Quick select (T28): find URLs, paths and commit hashes on screen and give each a short label to type.

export type TargetKind = 'url' | 'path' | 'hash';

export interface Match {
  kind: TargetKind;
  /** Offsets into the line's text. */
  start: number;
  end: number;
  text: string;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;
/** At least one slash: `src/a.ts`, `./x`, `~/y`, `/abs/z`, with an optional `:line[:col]`. */
const PATH_RE = /(?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)+[\w.@+-]*[\w@+-](?::\d+){0,2}/g;
/** A bare file name with an extension: `README.md`, `main.ts:12`. Base and extension of 2+ characters. */
const FILE_RE = /(?<![\w./-])[\w-]{2,}(?:\.[\w-]+)*\.[A-Za-z][\w]{1,7}(?::\d+){0,2}(?![\w/])/g;
/** 7–40 hex characters with a digit and a letter in them (so plain numbers and words like "defaced" don't count). */
const HASH_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;

/** Punctuation that ends a sentence rather than a URL. A `)` stays when the URL opened one. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"\]}>]+$/, '');
  while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
  return u.replace(/[.,;:!?]+$/, '');
}

/** Matches in one line of text, left to right, never overlapping (URLs win over paths, paths over hashes). */
export function findMatches(text: string): Match[] {
  const out: Match[] = [];
  const taken = (s: number, e: number) => out.some((m) => s < m.end && e > m.start);
  const scan = (re: RegExp, kind: TargetKind, trim?: (s: string) => string) => {
    for (const m of text.matchAll(re)) {
      const t = trim ? trim(m[0]) : m[0];
      const start = m.index;
      const end = start + t.length;
      if (t.length >= 3 && !taken(start, end)) out.push({ kind, start, end, text: t });
    }
  };
  scan(URL_RE, 'url', trimUrl);
  scan(PATH_RE, 'path', (s) => s.replace(/[.:]+$/, ''));
  scan(FILE_RE, 'path');
  scan(HASH_RE, 'hash');
  // A lone `/` or `//` from prose ("and/or" is fine, it's a path-looking word) is too short to be useful.
  return out.filter((m) => m.kind !== 'path' || /[\w~]/.test(m.text)).sort((a, b) => a.start - b.start);
}

/** Home row first, then the rest: the labels that are easiest to type go to the nearest targets. */
export const LABEL_KEYS = 'asdfjklghqwertyuiopzxcvbnm';

/** `n` labels, all of one length so none is a prefix of another (one letter up to 26, then two). */
export function makeLabels(n: number, keys = LABEL_KEYS): string[] {
  if (n <= keys.length) return [...keys.slice(0, n)];
  const out: string[] = [];
  for (const a of keys) for (const b of keys) if (out.length < n) out.push(a + b);
  return out;
}

/**
 * Labels per distinct text: the same URL shown twice gets one label. Texts are ordered from the bottom of the
 * screen up (the newest output is usually what you want), so the nearest get the easiest keys.
 */
export function assignLabels<T extends { text: string }>(targetsTopDown: readonly T[]): Map<string, string> {
  const texts: string[] = [];
  for (let i = targetsTopDown.length - 1; i >= 0; i--) {
    const t = targetsTopDown[i].text;
    if (!texts.includes(t)) texts.push(t);
  }
  const labels = makeLabels(Math.min(texts.length, LABEL_KEYS.length ** 2));
  return new Map(labels.map((l, i) => [texts[i], l]));
}

/**
 * Labels after the screen changed while quick select is open (output kept coming). A text that already has a label
 * keeps it, so nothing moves under the user's fingers; new texts get free labels of the same length, nearest
 * (bottom) first. Labels of texts that scrolled away stay taken, so a typed prefix never changes meaning. New texts
 * get none once the labels of that length run out.
 */
export function extendLabels<T extends { text: string }>(
  prev: ReadonlyMap<string, string>,
  targetsTopDown: readonly T[],
): Map<string, string> {
  const fresh: string[] = [];
  for (let i = targetsTopDown.length - 1; i >= 0; i--) {
    const t = targetsTopDown[i].text;
    if (!prev.has(t) && !fresh.includes(t)) fresh.push(t);
  }
  if (!fresh.length) return new Map(prev);
  const length = prev.size ? [...prev.values()][0].length : fresh.length > LABEL_KEYS.length ? 2 : 1;
  const used = new Set(prev.values());
  const free = makeLabels(length === 1 ? LABEL_KEYS.length : LABEL_KEYS.length ** 2).filter(
    (l) => !used.has(l),
  );
  const next = new Map(prev);
  fresh.forEach((t, i) => {
    if (free[i]) next.set(t, free[i]);
  });
  return next;
}

/** What a typed prefix means: a finished label, a prefix of some, or nothing. */
export function resolveLabel(prefix: string, labels: Iterable<string>): 'none' | 'partial' | string {
  let partial = false;
  for (const l of labels) {
    if (l === prefix) return l;
    if (l.startsWith(prefix)) partial = true;
  }
  return partial ? 'partial' : 'none';
}
