import { LIST_MARK, locate, parseBlocks, type Block, type BlockKind, type Line, type Parsed } from './blocks';
import { lineSeparator } from './serialize';

// Block operations as text splices (T77). Each returns the changes against the source (offsets into it, sorted,
// non-overlapping) — what CodeMirror dispatches as one transaction. Only the moved / edited lines and the line
// breaks around them change; every other byte stays as it was. Inserted line breaks use the file's own ending.

export interface Change {
  from: number;
  to: number;
  insert: string;
}

/** `src` with `changes` applied (sorted, non-overlapping, offsets into `src`). */
export function applyEdits(src: string, changes: readonly Change[]): string {
  let out = '';
  let last = 0;
  for (const c of changes) {
    out += src.slice(last, c.from) + c.insert;
    last = c.to;
  }
  return out + src.slice(last);
}

/** Where `pos` (outside every changed range) ends up after `changes`. */
export function mapPos(changes: readonly Change[], pos: number): number {
  let delta = 0;
  for (const c of changes)
    if (c.to <= pos && !(c.from === pos && c.to === pos)) delta += c.insert.length - (c.to - c.from);
  return pos + delta;
}

const listy = (k: BlockKind) => k === 'bullet' || k === 'ordered' || k === 'task';
/** Blocks that end on their own line: anything may follow them without a blank line. */
const closed = (k: BlockKind) => k === 'heading' || k === 'hr' || k === 'code' || k === 'frontmatter';
/** Blocks that can start right under a paragraph line without joining it. */
const interrupting = (k: BlockKind) =>
  k === 'heading' ||
  k === 'hr' ||
  k === 'code' ||
  k === 'quote' ||
  k === 'callout' ||
  k === 'html' ||
  listy(k);

/** `b` may follow `a` on the very next line (no blank line) and stay its own block. */
function tightOk(a: Block, b: Block): boolean {
  if (closed(a.kind)) return true;
  if (listy(a.kind))
    return (
      listy(b.kind) ||
      (b.kind !== 'paragraph' && b.kind !== 'image' && b.kind !== 'raw' && interrupting(b.kind))
    );
  return a.kind === 'paragraph' && interruptsText(b.kind);
}

/** Kinds that can start right under a line of paragraph text. An ordered item can't (only `1.` may, and the
 * numbers change), so it gets a blank line. */
const interruptsText = (k: BlockKind) => interrupting(k) && k !== 'ordered';

const breaks = (gap: string) => (gap.match(/\r\n?|\n/g) ?? []).length;
/** A gap (the text between two blocks, starting with the first one's line break) is enough to keep them apart. */
const enough = (gap: string | null, a: Block, b: Block) =>
  gap !== null && (breaks(gap) >= 2 || tightOk(a, b));
const between = (src: string, a: Block, b: Block) => src.slice(a.to, b.from);

/** What to remove to take `b` out: the block and one of the gaps beside it (the smaller one, so the rest stays apart). */
function cut(p: Parsed, b: Block): Change & { gap: string | null } {
  const loc = locate(p.blocks, b);
  const prev = loc && loc.index > 0 ? loc.siblings[loc.index - 1]! : null;
  const next = loc && loc.index < loc.siblings.length - 1 ? loc.siblings[loc.index + 1]! : null;
  const lead = prev ? between(p.src, prev, b) : null;
  const trail = next ? between(p.src, b, next) : null;
  if (next && (!prev || breaks(trail!) <= breaks(lead!)))
    return { from: b.from, to: next.from, insert: '', gap: trail };
  if (prev) return { from: prev.to, to: b.to, insert: '', gap: lead };
  // The only block in its container: a nested one goes with the blank lines and the line break before it.
  if (loc?.parent) {
    let k = b.line - 1;
    while (k > loc.parent.line && !p.lines[k]!.text.trim()) k--;
    return { from: p.lines[k]!.to, to: b.to, insert: '', gap: null };
  }
  return { from: b.from, to: b.to, insert: '', gap: null };
}

/** `body` (the lines of a block) with its first line's indentation `from` swapped for `to` on every line that has it. */
function reindent(body: string, from: string, to: string): string {
  if (from === to) return body;
  return body.replace(/(^|\r\n?|\n)([^\r\n]*)/g, (all, br: string, line: string) =>
    line.startsWith(from) && line.trim() ? br + to + line.slice(from.length) : all,
  );
}

export type Side = 'before' | 'after';

/** True when `inner` is `outer` or nested in it. */
const within = (inner: Block, outer: Block) => inner.line >= outer.line && inner.lastLine <= outer.lastLine;

/** Where a block's text goes `side` of `target`: the insertion with the gaps it needs, and where the body starts in it. */
function placement(
  p: Parsed,
  body: string,
  moved: Block,
  target: Block,
  side: Side,
  /** The gap the block had beside its own siblings: a list item keeps its list tight (or loose) with it. */
  own: string | null,
): { change: Change; lead: number } {
  const sep = lineSeparator(p.src);
  const loc = locate(p.blocks, target);
  const sibs = loc?.siblings ?? [target];
  const i = loc?.index ?? 0;
  const x = side === 'before' ? (sibs[i - 1] ?? null) : target;
  const y = side === 'before' ? target : (sibs[i + 1] ?? null);
  const text = reindent(body, moved.indent, target.indent);
  if (y) {
    const gap = x ? between(p.src, x, y) : null;
    // The first child of a list item sits right under the item's own text: a block that can't interrupt a
    // paragraph there would read as more of that text, so it gets a blank line above.
    const underText =
      !x &&
      !!loc?.parent &&
      y.line > 0 &&
      !!p.lines[y.line - 1]!.text.trim() &&
      !interruptsText(moved.kind) &&
      !(listy(moved.kind) && listy(y.kind)); // an item joining the list already there
    const pre = (x && !enough(gap, x, moved)) || underText ? sep : '';
    const post =
      own !== null && listy(moved.kind) && listy(y.kind)
        ? own
        : gap !== null && enough(gap, moved, y)
          ? gap
          : tightOk(moved, y)
            ? sep
            : sep + sep;
    return {
      change: { from: y.from, to: y.from, insert: pre + text + post },
      lead: pre.length,
    };
  }
  // After the last block of its container.
  const prev = sibs[i - 1];
  const gap = prev ? between(p.src, prev, target) : null;
  const pre =
    own !== null && listy(moved.kind) && listy(target.kind)
      ? own
      : gap !== null && enough(gap, target, moved)
        ? gap
        : tightOk(target, moved)
          ? sep
          : sep + sep;
  return {
    change: { from: target.to, to: target.to, insert: pre + text },
    lead: pre.length,
  };
}

export interface MoveResult {
  changes: Change[];
  /** Maps an offset inside the moved block to where it is afterwards. */
  map: (pos: number) => number;
}

/** Moves `b` (with its nested blocks) `side` of `target`. Null when that's where it already is. */
export function moveBlock(p: Parsed, b: Block, target: Block, side: Side): MoveResult | null {
  if (within(target, b) || target.kind === 'frontmatter' || b.kind === 'frontmatter') return null;
  const loc = locate(p.blocks, target);
  const sibs = loc?.siblings ?? [];
  const i = loc?.index ?? -1;
  if (side === 'before' && sibs[i - 1] === b) return null;
  if (side === 'after' && sibs[i + 1] === b) return null;
  const body = p.src.slice(b.from, b.to);
  const remove = cut(p, b);
  const { change: insert, lead } = placement(p, body, b, target, side, remove.gap);
  const moved = remove.from < insert.from ? [remove, insert] : [insert, remove];
  if (applyEdits(p.src, moved) === p.src) return null;
  const start = mapPos(moved, insert.from) + lead;
  const { changes, edits } = renumber(p.src, moved);
  return {
    changes,
    map: (pos) =>
      shift(
        edits,
        start +
          reindent(body.slice(0, Math.max(0, Math.min(pos, b.to) - b.from)), b.indent, target.indent).length,
      ),
  };
}

/** The block before / after `b` among its siblings, to move it one step with the keyboard. */
export function stepTarget(p: Parsed, b: Block, dir: -1 | 1): { target: Block; side: Side } | null {
  const loc = locate(p.blocks, b);
  if (!loc) return null;
  const t = loc.siblings[loc.index + dir];
  if (!t || t.kind === 'frontmatter') return null;
  return { target: t, side: dir < 0 ? 'before' : 'after' };
}

/** A copy of `b` right under it. */
export function duplicateBlock(p: Parsed, b: Block): Change[] {
  if (b.kind === 'frontmatter') return [];
  return renumbered(p.src, [placement(p, p.src.slice(b.from, b.to), b, b, 'after', cut(p, b).gap).change]);
}

/** Removes `b` (with its nested blocks) and one gap beside it. */
export function deleteBlock(p: Parsed, b: Block): Change[] {
  const { from, to, insert } = cut(p, b);
  return renumbered(p.src, [{ from, to, insert }]);
}

// ---- Ordered lists ----

/** An ordered item's number token (offsets into the source), its value and its delimiter (`.` or `)`). */
function numberOf(lines: Line[], b: Block): { from: number; to: number; n: number; delim: string } | null {
  if (!listy(b.kind)) return null;
  const l = lines[b.line]!;
  const ind = l.text.length - l.text.trimStart().length;
  const m = /^(\d{1,9})([.)])/.exec(l.text.slice(ind));
  if (!m) return null;
  return { from: l.from + ind, to: l.from + ind + m[1]!.length, n: Number(m[1]), delim: m[2]! };
}

/** Lists: runs of sibling ordered items with the same delimiter, at every depth. */
function orderedRuns(blocks: Block[], lines: Line[], out: Block[][] = []): Block[][] {
  let run: Block[] | null = null;
  let delim = '';
  for (const b of blocks) {
    const m = numberOf(lines, b);
    if (m && run && m.delim === delim) run.push(b);
    else if (m) {
      run = [b];
      delim = m.delim;
      out.push(run);
    } else run = null;
    orderedRuns(b.children, lines, out);
  }
  return out;
}

/** Where `pos` ends up after `changes`, past anything inserted right at it. */
function mapAfter(changes: readonly Change[], pos: number): number {
  let delta = 0;
  for (const c of changes) if (c.to <= pos) delta += c.insert.length - (c.to - c.from);
  return pos + delta;
}

/** `pos` (in the text after `changes`) moved by the renumbering `edits` (offsets into that same text). */
function shift(edits: readonly Change[], pos: number): number {
  let delta = 0;
  for (const e of edits) if (e.to <= pos) delta += e.insert.length - (e.to - e.from);
  return pos + delta;
}

/**
 * `changes` plus the renumbering of every ordered list they touch: only the number tokens change, each list keeps
 * its start number (the one it had before) and its delimiter, and a list numbered `1.` `1.` `1.` stays that way.
 * `edits` are the renumberings in the text after `changes`, to map positions.
 */
function renumber(src: string, changes: Change[]): { changes: Change[]; edits: Change[] } {
  const none = { changes, edits: [] };
  if (!changes.length) return none;
  const before = parseBlocks(src);
  const touched = (b: Block) =>
    changes.some(
      (c) => (c.from < b.to && c.to > b.from) || (c.from === c.to && c.from > b.from && c.from < b.to),
    );
  // Each list before the edit, keyed by where its first untouched item lands afterwards.
  const starts = new Map<number, { start: number; lazy: boolean; dirty: boolean }>();
  for (const run of orderedRuns(before.blocks, before.lines)) {
    const nums = run.map((b) => numberOf(before.lines, b)!.n);
    const first = run.find((b) => !touched(b));
    if (first)
      starts.set(mapAfter(changes, first.from), {
        start: nums[0]!,
        lazy: nums.length > 1 && nums.every((n) => n === nums[0]),
        dirty: run.some(touched),
      });
  }
  const text = applyEdits(src, changes);
  const after = parseBlocks(text);
  const spans: { from: number; to: number }[] = [];
  let delta = 0;
  for (const c of changes) {
    spans.push({ from: c.from + delta, to: c.from + delta + c.insert.length });
    delta += c.insert.length - (c.to - c.from);
  }
  const inserted = (b: Block) => spans.some((s) => s.to > s.from && s.from <= b.from && b.to <= s.to);
  const edits: Change[] = [];
  for (const run of orderedRuns(after.blocks, after.lines)) {
    const a = run[0]!.from;
    const z = run[run.length - 1]!.to;
    const known = run.map((b) => starts.get(b.from)).find((x) => x);
    // A list the changes reach, or what's left of one they took an item from.
    if (!spans.some((s) => s.from <= z && s.to >= a) && !known?.dirty) continue;
    const marks = run.map((b) => numberOf(after.lines, b)!);
    const kept = marks.filter((_, k) => !inserted(run[k]!)).map((m) => m.n);
    const start = known?.start ?? marks[0]!.n;
    const lazy = known ? known.lazy : kept.length > 1 && kept.every((n) => n === kept[0]);
    marks.forEach((m, k) => {
      const want = lazy ? start : start + k;
      if (m.n !== want) edits.push({ from: m.from, to: m.to, insert: String(want) });
    });
  }
  if (!edits.length) return none;
  // Back into offsets of `src`: an edit inside inserted text changes that insertion, any other is a change of its own.
  const out = changes.map((c) => ({ ...c }));
  const extra: Change[] = [];
  for (const e of [...edits].reverse()) {
    const k = spans.findIndex((s) => s.to > s.from && s.from <= e.from && e.to <= s.to);
    if (k >= 0) {
      const c = out[k]!;
      const at = e.from - spans[k]!.from;
      c.insert = c.insert.slice(0, at) + e.insert + c.insert.slice(at + (e.to - e.from));
    } else {
      let d = 0;
      for (let i = 0; i < spans.length; i++)
        if (spans[i]!.to <= e.from) d += changes[i]!.insert.length - (changes[i]!.to - changes[i]!.from);
      extra.push({ from: e.from - d, to: e.to - d, insert: e.insert });
    }
  }
  const all = [...out, ...extra].sort((x, y) => x.from - y.from || x.to - x.from - (y.to - y.from));
  return { changes: all, edits };
}

/** `changes` with the ordered lists they touch renumbered. */
export function renumbered(src: string, changes: Change[]): Change[] {
  return renumber(src, changes).changes;
}

// ---- Turn into ----

export type TurnKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'task' | 'quote';

/** Kinds whose markers can be swapped. Code, tables, frontmatter etc. stay what they are. */
export const canTurn = (k: BlockKind) =>
  k === 'paragraph' || k === 'heading' || listy(k) || k === 'quote' || k === 'callout';

/** The smallest change turning `old` into `next` at `at` (common prefix and suffix left alone). */
function minimal(at: number, old: string, next: string): Change | null {
  if (old === next) return null;
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let z = 0;
  while (z < old.length - a && z < next.length - a && old[old.length - 1 - z] === next[next.length - 1 - z])
    z++;
  return {
    from: at + a,
    to: at + old.length - z,
    insert: next.slice(a, next.length - z),
  };
}

/** The marker in front of a line's text (after its indentation) for the block kinds that have one. */
function markerOf(text: string, kind: BlockKind): string {
  const s = text.slice(text.length - text.trimStart().length);
  if (kind === 'heading') return /^#{1,6}(?:[ \t]+|$)/.exec(s)?.[0] ?? '';
  if (listy(kind)) {
    const m = LIST_MARK.exec(s);
    if (!m) return '';
    const task = /^\[[ xX]\](?:[ \t]+|$)/.exec(s.slice(m[0].length));
    return m[0] + (task?.[0] ?? '');
  }
  return '';
}

/** The marker of `kind`, keeping what it can of the old one (`*` bullets, `3)` numbers, a checked box). */
function newMarker(kind: TurnKind, old: string): string {
  const bullet = /^[-*+]/.exec(old)?.[0] ?? '-';
  switch (kind) {
    case 'h1':
      return '# ';
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    case 'bullet':
      return `${bullet} `;
    case 'ordered':
      return `${/^\d+[.)]/.exec(old)?.[0] ?? '1.'} `;
    case 'task':
      return `${bullet} ${/\[[ xX]\]/.exec(old)?.[0] ?? '[ ]'} `;
    default:
      return '';
  }
}

const QUOTE_MARK = /^[ \t]*>[ \t]?/;
const CALLOUT_TAG = /^\[![A-Za-z-]+\][+-]?[ \t]*/;

/** Turns `b` into another kind by editing only its markers (`#`, `-`, `1.`, `[ ]`, `>`). */
export function turnInto(p: Parsed, b: Block, kind: TurnKind): Change[] {
  return renumbered(p.src, markerChanges(p, b, kind));
}

function markerChanges(p: Parsed, b: Block, kind: TurnKind): Change[] {
  if (!canTurn(b.kind)) return [];
  const { lines } = p;
  const out: Change[] = [];
  const push = (c: Change | null) => {
    if (c) out.push(c);
  };
  if (b.kind === 'quote' || b.kind === 'callout') {
    if (kind === 'quote' && b.kind === 'quote') return [];
    // A callout's `[!NOTE]` (and its line, when nothing else is on it).
    const top = lines[b.line]!;
    const q0 = QUOTE_MARK.exec(top.text)![0].length;
    const tag = b.kind === 'callout' ? (CALLOUT_TAG.exec(top.text.slice(q0))?.[0].length ?? 0) : 0;
    const tagLine = tag > 0 && q0 + tag === top.text.length && b.lastLine > b.line;
    if (kind === 'quote')
      return [
        tagLine
          ? { from: top.from, to: top.end, insert: '' }
          : { from: top.from + q0, to: top.from + q0 + tag, insert: '' },
      ];
    // Every line loses its `>`; the first content line gets the new marker in its place.
    const marker = newMarker(kind, '');
    const first = tagLine ? b.line + 1 : b.line;
    if (tagLine) out.push({ from: top.from, to: top.end, insert: '' });
    for (let n = first; n <= b.lastLine; n++) {
      const l = lines[n]!;
      const drop = (QUOTE_MARK.exec(l.text)?.[0].length ?? 0) + (n === b.line ? tag : 0);
      push(minimal(l.from, l.text.slice(0, drop), n === first ? marker : ''));
    }
    return out;
  }
  const l = lines[b.line]!;
  const indent = /^[ \t]*/.exec(l.text)![0].length;
  const old = markerOf(l.text, b.kind);
  if (kind === 'quote') {
    // `> ` at the start of every line; the first line's own marker goes.
    for (let n = b.line; n <= b.lastLine; n++) {
      const ln = lines[n]!;
      const q = ln.text.trim() ? '> ' : '>';
      if (n === b.line && old)
        push({
          from: ln.from,
          to: ln.from + indent + old.length,
          insert: q + l.text.slice(0, indent),
        });
      else push({ from: ln.from, to: ln.from, insert: q });
    }
    return out;
  }
  if (b.setext) {
    // Setext stays setext as h1 / h2 (only the underline changes); anything else drops the underline.
    const u = lines[b.lastLine]!;
    if (kind === 'h1' || kind === 'h2') {
      push(minimal(u.from, u.text, u.text.replace(/[=-]/g, kind === 'h1' ? '=' : '-')));
      return out;
    }
    push(minimal(l.from + indent, '', newMarker(kind, '')));
    push({ from: lines[b.lastLine - 1]!.to, to: u.to, insert: '' });
    return out;
  }
  push(minimal(l.from + indent, old, newMarker(kind, old)));
  return out;
}
// ---- Slash menu ----

export type SlashKind =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'quote'
  | 'callout'
  | 'code'
  | 'table'
  | 'divider'
  | 'link';

export const SLASH_KINDS: readonly SlashKind[] = [
  'h1',
  'h2',
  'h3',
  'bullet',
  'ordered',
  'task',
  'quote',
  'callout',
  'code',
  'table',
  'divider',
  'link',
];

/**
 * The text a slash item inserts in place of `/query`, and where the cursor goes in it. `prevBlank` says the line
 * above is blank (or there's none): a divider right under text would turn that text into a heading (`---`).
 */
export function slashSnippet(
  kind: SlashKind,
  sep: string,
  prevBlank: boolean,
): { insert: string; cursor: number } {
  const at = (insert: string, cursor = insert.length) => ({ insert, cursor });
  switch (kind) {
    case 'h1':
      return at('# ');
    case 'h2':
      return at('## ');
    case 'h3':
      return at('### ');
    case 'bullet':
      return at('- ');
    case 'ordered':
      return at('1. ');
    case 'task':
      return at('- [ ] ');
    case 'quote':
      return at('> ');
    case 'callout':
      return at(`> [!NOTE]${sep}> `);
    case 'code':
      return at(`\`\`\`${sep}${sep}\`\`\``, 3 + sep.length);
    case 'table':
      return at(`|  |  |${sep}| --- | --- |${sep}|  |  |`, 2);
    case 'divider': {
      const pre = prevBlank ? '' : sep;
      return at(`${pre}---${sep}`);
    }
    case 'link':
      return at('[[');
  }
}

/** The change replacing `/query` (from the `/` at `slash` up to `cursor`) with a slash item. */
export function slashInsert(
  src: string,
  lines: Line[],
  slash: number,
  cursor: number,
  kind: SlashKind,
): { change: Change; cursor: number } {
  const sep = lineSeparator(src);
  let n = 0;
  while (n + 1 < lines.length && lines[n + 1]!.from <= slash) n++;
  const prevBlank = n === 0 || !lines[n - 1]!.text.trim();
  const s = slashSnippet(kind, sep, prevBlank);
  return { change: { from: slash, to: cursor, insert: s.insert }, cursor: slash + s.cursor };
}
