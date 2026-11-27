// A note's YAML frontmatter as properties (T78): read with the exact offsets of each key's lines, and changed by a
// minimal text splice — only the lines of the key that changes are rewritten; key order, quoting style, list style
// and indentation, line endings and every other byte stay as they were. Just enough YAML for frontmatter:
// `key: value`, `key: "quoted"`, `key: [a, b]`, `key:` + `- item` lines. Anything else (nested maps, `|` blocks)
// is shown raw and never rewritten by the panel.

export type PropValue = string | string[];

export type PropStyle = 'scalar' | 'flow' | 'block' | 'raw';

export interface FmEntry {
  key: string;
  value: PropValue;
  style: PropStyle;
  /** Quote of the scalar, or of the first list item: kept when the value is rewritten. */
  quote: '' | '"' | "'";
  /** Block lists: the items' indent (`  ` in `  - a`). */
  indent: string;
  /** `key:` as written (spacing before the colon kept). */
  head: string;
  /** What follows the colon before the value (` `, `  `). */
  gap: string;
  /** Offsets in the text: start of the key line, end of its last line (before that line's break). */
  from: number;
  to: number;
}

export interface Frontmatter {
  entries: FmEntry[];
  /** Start of the closing `---` line (new keys go right before it). */
  closeAt: number;
  /** The opening line's break: new lines use it. */
  eol: string;
}

interface Line {
  start: number;
  /** End of the text, before the break. */
  end: number;
  /** Start of the next line. */
  next: number;
}

function linesOf(src: string, from: number): Line[] {
  const out: Line[] = [];
  const re = /\r\n|\r|\n/g;
  re.lastIndex = from;
  let start = from;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push({ start, end: m.index, next: m.index + m[0].length });
    start = m.index + m[0].length;
  }
  if (start < src.length) out.push({ start, end: src.length, next: src.length });
  return out;
}

const KEY_LINE = /^([^\s#:'"\-[{][^:]*?)(\s*:)(?=[ \t]|$)([ \t]*)(.*)$/;
const ITEM = /^(\s*)-(?:[ \t]+(.*))?$/;

function unquoteScalar(s: string): { value: string; quote: FmEntry['quote'] } {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const v: unknown = JSON.parse(t);
      if (typeof v === 'string') return { value: v, quote: '"' };
    } catch {
      /* YAML escapes JSON doesn't know: shown as written */
    }
    return { value: t.slice(1, -1), quote: '"' };
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'"))
    return { value: t.slice(1, -1).replace(/''/g, "'"), quote: "'" };
  return { value: t, quote: '' };
}

/** `a, "b, c", 'd'` → items, honouring quotes. */
function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (q) {
      cur += c;
      if (c === '\\' && q === '"' && i + 1 < inner.length) cur += inner[++i];
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out.map((x) => x.trim()).filter((x, i, a) => x || i < a.length - 1);
}

const isFlowList = (v: string) => /^\[.*\]$/.test(v) && !/^\[\[.*\]\]$/.test(v);

/** The frontmatter at the very top of the note (`---` … `---`/`...`), or null when it has none. */
export function readFrontmatter(src: string): Frontmatter | null {
  const open = /^---[ \t]*(\r\n|\r|\n)/.exec(src);
  if (!open) return null;
  const lines = linesOf(src, open[0].length);
  const close = lines.findIndex((l) => /^(?:---|\.\.\.)[ \t]*$/.test(src.slice(l.start, l.end)));
  if (close < 0) return null;
  const entries: FmEntry[] = [];
  let i = 0;
  while (i < close) {
    const l = lines[i]!;
    const text = src.slice(l.start, l.end);
    const kv = KEY_LINE.exec(text);
    if (!kv || /^\s/.test(text)) {
      i++;
      continue;
    }
    const [, rawKey, colon, gap, rest] = kv as unknown as [string, string, string, string, string];
    // Continuation: indented lines, and `- item` lines right under the key (block lists may sit at column 0).
    let j = i + 1;
    while (j < close) {
      const t = src.slice(lines[j]!.start, lines[j]!.end);
      if (!t.trim()) break;
      if (/^\s/.test(t) || (ITEM.test(t) && !rest.trim())) j++;
      else break;
    }
    const cont = lines.slice(i + 1, j).map((x) => src.slice(x.start, x.end));
    const entry: FmEntry = {
      key: rawKey.trim(),
      value: '',
      style: 'scalar',
      quote: '',
      indent: '  ',
      head: rawKey + colon,
      gap,
      from: l.start,
      to: lines[j - 1]!.end,
    };
    const v = rest.trim();
    if (v) {
      if (cont.length || /^[|>]/.test(v)) {
        entry.style = 'raw';
        entry.value = [v, ...cont.map((c) => c.trim())].join('\n');
      } else if (isFlowList(v)) {
        entry.style = 'flow';
        const items = splitFlow(v.slice(1, -1)).map(unquoteScalar);
        entry.value = items.map((x) => x.value);
        entry.quote = items.find((x) => x.quote)?.quote ?? '';
      } else {
        const u = unquoteScalar(v);
        entry.value = u.value;
        entry.quote = u.quote;
      }
    } else if (cont.length && cont.every((c) => ITEM.test(c))) {
      entry.style = 'block';
      const items = cont.map((c) => ITEM.exec(c)!);
      entry.indent = items[0]![1];
      const vals = items.map((m) => unquoteScalar(m[2] ?? ''));
      entry.value = vals.map((x) => x.value);
      entry.quote = vals.find((x) => x.quote)?.quote ?? '';
    } else if (cont.length) {
      entry.style = 'raw';
      entry.value = cont.map((c) => c.trim()).join('\n');
    }
    entries.push(entry);
    i = j;
  }
  return { entries, closeAt: lines[close]!.start, eol: open[1]! };
}

/** The first line break in the text (`\n` when it has none). */
const eolOf = (src: string) => /\r\n|\r|\n/.exec(src)?.[0] ?? '\n';

/** Characters that make a plain YAML scalar mean something else. */
const PLAIN_UNSAFE = /^[\s[\]{}#&*!|>'"%@`,?:-]|: |\s#|\s$|[\r\n]/;
const ITEM_UNSAFE = /^[\s[\]{}#&*!|>'"%@`?:-]|[,[\]{}]|: |\s#|\s$|[\r\n]|^$/;

function quoted(v: string, quote: FmEntry['quote']): string {
  if (quote === "'" && !/[\r\n]/.test(v)) return `'${v.replace(/'/g, "''")}'`;
  return JSON.stringify(v);
}

/** A scalar in the entry's quoting style; plain when it was plain and stays safe, else double-quoted. */
export function formatScalar(v: string, quote: FmEntry['quote'] = ''): string {
  if (quote) return quoted(v, quote);
  return PLAIN_UNSAFE.test(v) ? JSON.stringify(v) : v;
}

function formatItem(v: string, quote: FmEntry['quote'], flow: boolean): string {
  if (quote) return quoted(v, quote);
  return (flow ? ITEM_UNSAFE : PLAIN_UNSAFE).test(v) || !v ? JSON.stringify(v) : v;
}

const same = (a: PropValue, b: PropValue) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x, i) => x === b[i])
    : !Array.isArray(a) && !Array.isArray(b) && a === b;

/** A frontmatter key a property may have: one line, no colon, not starting with YAML syntax. */
export function validKey(key: string): boolean {
  const k = key.trim();
  return !!k && k.length <= 80 && !/[:\r\n]/.test(k) && !/^[#\-[\]{}'"&*!|>%@`?,]/.test(k);
}

function entryLines(
  e: Pick<FmEntry, 'head' | 'gap' | 'style' | 'quote' | 'indent'>,
  value: PropValue,
  eol: string,
) {
  const gap = e.gap || ' ';
  if (Array.isArray(value)) {
    if (e.style === 'block' && value.length)
      return [e.head, ...value.map((v) => `${e.indent}- ${formatItem(v, e.quote, false)}`)].join(eol);
    return `${e.head}${gap}[${value.map((v) => formatItem(v, e.quote, true)).join(', ')}]`;
  }
  return value ? `${e.head}${gap}${formatScalar(value, e.style === 'scalar' ? e.quote : '')}` : e.head;
}

/**
 * The text with `key` set to `value`. An existing key's lines are replaced in place (its style kept); a new key goes
 * last, before the closing `---`; a note without frontmatter gets a block at the very top. Same value → same text.
 */
export function setProp(src: string, key: string, value: PropValue): string {
  const k = key.trim();
  if (!validKey(k)) return src;
  const fm = readFrontmatter(src);
  if (!fm) {
    const eol = eolOf(src);
    const line = entryLines(
      { head: `${k}:`, gap: ' ', style: 'scalar', quote: '', indent: '  ' },
      value,
      eol,
    );
    return `---${eol}${line}${eol}---${eol}${src}`;
  }
  const e = fm.entries.find((x) => x.key === k);
  if (!e) {
    const line = entryLines(
      { head: `${k}:`, gap: ' ', style: 'scalar', quote: '', indent: '  ' },
      value,
      fm.eol,
    );
    return `${src.slice(0, fm.closeAt)}${line}${fm.eol}${src.slice(fm.closeAt)}`;
  }
  if (e.style !== 'raw' && same(e.value, value)) return src;
  // A line break inside the entry uses the break its first line ends with.
  const eol = /\r\n|\r|\n/.exec(src.slice(e.to))?.[0] ?? fm.eol;
  const style: PropStyle = e.style === 'raw' ? 'scalar' : e.style;
  return `${src.slice(0, e.from)}${entryLines({ ...e, style }, value, eol)}${src.slice(e.to)}`;
}

/** The text without `key`'s lines (and their line break). No such key → same text. */
export function removeProp(src: string, key: string): string {
  const fm = readFrontmatter(src);
  const e = fm?.entries.find((x) => x.key === key.trim());
  if (!fm || !e) return src;
  const brk = /^(\r\n|\r|\n)/.exec(src.slice(e.to))?.[0] ?? '';
  return `${src.slice(0, e.from)}${src.slice(e.to + brk.length)}`;
}

/** What the panel shows a property as. */
export type PropKind = 'text' | 'date' | 'select' | 'tags' | 'raw';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A property's kind: the source's settings say (if any), else lists are tags, `YYYY-MM-DD` a date, the rest text. */
export function kindOf(e: Pick<FmEntry, 'style' | 'value'>, declared?: string): PropKind {
  if (e.style === 'raw') return 'raw';
  if (declared === 'tags' || Array.isArray(e.value)) return 'tags';
  if (declared === 'select') return 'select';
  if (declared === 'date' && (!e.value || ISO_DATE.test(e.value))) return 'date';
  if (declared === 'text') return 'text';
  return typeof e.value === 'string' && ISO_DATE.test(e.value) ? 'date' : 'text';
}
