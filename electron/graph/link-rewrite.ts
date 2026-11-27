// Note explorer (T83): when notes are renamed or moved, the links to them in other notes — and a moved note's own
// relative links — are rewritten. Only the link spans change (minimal splices on the original string), so CRLF, a
// BOM, trailing spaces and every other byte stay as they were. Code fences and inline code are never touched.
import path from 'node:path';

/** A note's path inside its source before and after (`/`-separated). */
export interface FileMove {
  from: string;
  to: string;
}

export interface Splice {
  from: number;
  to: number;
  insert: string;
}

const stripMd = (s: string) => s.replace(/\.md$/i, '');
const baseOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Offsets of fenced code blocks and inline code spans: links there stay as written. */
export function codeRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  let fence: string | null = null;
  let fenceStart = 0;
  let at = 0;
  for (const line of text.split('\n')) {
    const start = at;
    at += line.length + 1;
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) {
        out.push([fenceStart, Math.min(at, text.length)]);
        fence = null;
      }
      continue;
    }
    if (f) {
      fence = f[1]!;
      fenceStart = start;
      continue;
    }
    for (const m of line.matchAll(/(`+)[^`]+?\1/g))
      out.push([start + m.index, start + m.index + m[0].length]);
  }
  if (fence) out.push([fenceStart, text.length]);
  return out;
}

const inRanges = (i: number, ranges: readonly [number, number][]) => ranges.some(([a, b]) => i >= a && i < b);

/** The new target of a `[[wikilink]]` target, or null when the link doesn't change. */
function wikiTarget(target: string, moves: readonly FileMove[]): string | null {
  const t = stripMd(target.trim()).toLowerCase();
  if (!t) return null;
  if (t.includes('/')) {
    const k = t.split('/').length;
    for (const m of moves) {
      const old = stripMd(m.from).toLowerCase();
      if (old !== t && !old.endsWith(`/${t}`)) continue;
      const next = stripMd(m.to);
      const out = old === t ? next : next.split('/').slice(-k).join('/');
      return out.toLowerCase() === t ? null : out;
    }
    return null;
  }
  for (const m of moves) {
    if (stripMd(baseOf(m.from)).toLowerCase() !== t) continue;
    const next = stripMd(baseOf(m.to));
    return next.toLowerCase() === t ? null : next;
  }
  return null;
}

/** Only what would end or break a bare link is escaped (spaces, parentheses, `%`); Korean stays readable. */
function encodeHref(p: string): string {
  return p.replace(/[ %()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/**
 * The splices that fix the links in one note's text. `noteFrom` / `noteTo`: where this note was and is now (the
 * same when it didn't move); relative Markdown links are read against where it was and written for where it is.
 * A note that stayed only follows moved notes (`.md` links); a note that moved re-bases every relative link it has —
 * images `![](x.png)` and other files `[pdf](files/x.pdf)` too.
 */
export function linkSplices(
  text: string,
  noteFrom: string,
  noteTo: string,
  moves: readonly FileMove[],
): Splice[] {
  const code = codeRanges(text);
  const out: Splice[] = [];
  const byFrom = new Map(moves.map((m) => [m.from.toLowerCase(), m.to]));

  for (const m of text.matchAll(/\[\[([^[\]\n]+?)\]\]/g)) {
    if (inRanges(m.index, code)) continue;
    const inner = m[1]!;
    const cut = inner.search(/[#|]/);
    const targetPart = cut < 0 ? inner : inner.slice(0, cut);
    const lead = targetPart.length - targetPart.trimStart().length;
    const raw = targetPart.trim();
    const next = wikiTarget(raw, moves);
    if (next === null) continue;
    const keepMd = /\.md$/i.test(raw);
    const from = m.index + 2 + lead;
    out.push({ from, to: from + raw.length, insert: keepMd ? `${next}.md` : next });
  }

  const noteMoved = noteFrom !== noteTo;
  for (const m of text.matchAll(/(!?)\[([^\]\n]*)\]\(([ \t]*)(<[^>\n]*>|[^)\s]+)/g)) {
    // An image or a non-note file never moves with a rename, so only a moved note re-bases those (below).
    if ((m[1] && !noteMoved) || inRanges(m.index, code)) continue;
    const href = m[4]!;
    const angled = href.startsWith('<');
    const bare = angled ? href.slice(1, -1) : href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith('/') || bare.startsWith('#')) continue;
    const cut = bare.search(/[#?]/);
    const pathPart = cut < 0 ? bare : bare.slice(0, cut);
    const suffix = cut < 0 ? '' : bare.slice(cut);
    const isNote = !m[1] && /\.md$/i.test(pathPart);
    if (!isNote && !noteMoved) continue;
    let decoded = pathPart;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      // not encoded: as written
    }
    const oldTarget = path.posix.normalize(path.posix.join(dirOf(noteFrom), decoded));
    if (oldTarget.startsWith('../')) continue;
    const moved = isNote ? byFrom.get(oldTarget.toLowerCase()) : undefined;
    if (!moved && !noteMoved) continue;
    const target = moved ?? oldTarget;
    let rel = path.posix.relative(dirOf(noteTo), target);
    if (decoded.startsWith('./') && !rel.startsWith('../')) rel = `./${rel}`;
    if (rel === decoded) continue;
    // Encoded as written; a bare link to a name with a space must be encoded, or it stops being a link.
    const encoded = angled ? rel : decoded !== pathPart || /[\s()<>]/.test(rel) ? encodeHref(rel) : rel;
    const insert = angled ? `<${encoded}${suffix}>` : `${encoded}${suffix}`;
    const from = m.index + m[0].length - href.length;
    out.push({ from, to: from + href.length, insert });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Applies splices (sorted, not overlapping) to the text. */
export function applySplices(text: string, splices: readonly Splice[]): string {
  let out = '';
  let at = 0;
  for (const s of splices) {
    out += text.slice(at, s.from) + s.insert;
    at = s.to;
  }
  return out + text.slice(at);
}
