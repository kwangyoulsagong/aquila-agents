import { isDelimiter, isRow } from './tables';

// A block model over the Markdown text (T77): the source split into blocks with exact offsets, so block
// operations (move, turn into, duplicate, delete) are splices of the original string. Nothing is re-rendered from
// a tree: what the parser doesn't know is an opaque `raw` block, moved as the bytes it is.

export type BlockKind =
  | 'frontmatter'
  | 'heading'
  | 'paragraph'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'quote'
  | 'callout'
  | 'code'
  | 'table'
  | 'hr'
  | 'image'
  | 'html'
  | 'raw';

export interface Line {
  text: string;
  /** Offset of the line's first character. */
  from: number;
  /** Offset just past its text (before the line break). */
  to: number;
  /** Offset just past its line break (= `to` on the last line). */
  end: number;
}

export interface Block {
  kind: BlockKind;
  /** Start of the block's first line. */
  from: number;
  /** End of its last line's text (before the line break): the block is `src.slice(from, to)`. */
  to: number;
  /** First and last line (0-based, inclusive). */
  line: number;
  lastLine: number;
  /** Leading whitespace of the first line (its characters). */
  indent: string;
  /** Heading level (1–6); `setext` when it's underlined (`===` / `---`). */
  level?: number;
  setext?: boolean;
  /** Blocks nested under a list item (its indented lines after the first). */
  children: Block[];
}

export interface Parsed {
  src: string;
  lines: Line[];
  blocks: Block[];
}

export function splitLines(src: string): Line[] {
  const out: Line[] = [];
  const re = /\r\n?|\n/g;
  let from = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push({ text: src.slice(from, m.index), from, to: m.index, end: m.index + m[0].length });
    from = m.index + m[0].length;
  }
  out.push({ text: src.slice(from), from, to: src.length, end: src.length });
  return out;
}

const blank = (t: string) => /^[ \t]*$/.test(t);

/** Width of the leading whitespace in columns (a tab goes to the next multiple of 4). */
function columns(t: string): number {
  let c = 0;
  for (const ch of t) {
    if (ch === ' ') c++;
    else if (ch === '\t') c += 4 - (c % 4);
    else break;
  }
  return c;
}

const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const HEADING = /^[ \t]*(#{1,6})(?:[ \t]|$)/;
const HR = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^[ \t]*>/;
export const CALLOUT = /^[ \t]*>[ \t]?\[![A-Za-z-]+\]/;
/** A list item's marker (after its indentation), with the spaces after it. */
export const LIST_MARK = /^([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TASK = /^\[[ xX]\](?:[ \t]|$)/;
const HTML = /^[ \t]*<(?:[A-Za-z][\w-]*|!--|\/[A-Za-z]|\?|!)/;
const IMAGE_LINE = /^[ \t]*(?:!\[[^\]\n]*\]\([^)\n]*\)|!\[\[[^\]\n]+\]\])[ \t]*$/;
const LINK_DEF = /^[ \t]*\[[^\]\n]+\]:/;
const MATH = /^[ \t]*\$\$/;
const SETEXT = /^[ \t]*(=+|-+)[ \t]*$/;

function listMark(t: string): RegExpExecArray | null {
  return LIST_MARK.exec(t.slice(t.length - t.trimStart().length));
}

const isTableStart = (lines: Line[], i: number, b: number) =>
  isRow(lines[i]!.text) && i + 1 < b && isDelimiter(lines[i + 1]!.text);

/** A line that starts a block of its own: it ends a paragraph (or a list item's lazy text). */
function interrupts(lines: Line[], i: number, b: number): boolean {
  const t = lines[i]!.text;
  return (
    blank(t) ||
    FENCE.test(t) ||
    HEADING.test(t) ||
    (HR.test(t) && !/^[ \t]*-/.test(t)) ||
    QUOTE.test(t) ||
    HTML.test(t) ||
    MATH.test(t) ||
    !!listMark(t) ||
    isTableStart(lines, i, b)
  );
}

function block(lines: Line[], kind: BlockKind, i: number, j: number, extra?: Partial<Block>): Block {
  const first = lines[i]!;
  return {
    kind,
    from: first.from,
    to: lines[j - 1]!.to,
    line: i,
    lastLine: j - 1,
    indent: /^[ \t]*/.exec(first.text)![0],
    children: [],
    ...extra,
  };
}

/** Frontmatter: `---` on the first line up to the next `---` / `...` (within 200 lines, like the live preview). */
function frontmatter(lines: Line[]): number {
  if (lines.length < 2 || lines[0]!.text !== '---') return 0;
  for (let k = 1; k < Math.min(lines.length, 200); k++)
    if (/^(---|\.\.\.)$/.test(lines[k]!.text)) return k + 1;
  return 0;
}

/** Blocks in lines [a, b). `base` is the indentation (columns) of the container the lines are in. */
function parseRange(lines: Line[], a: number, b: number, base: number): Block[] {
  const out: Block[] = [];
  let i = a;
  if (a === 0) {
    const fm = frontmatter(lines);
    if (fm) {
      out.push(block(lines, 'frontmatter', 0, fm));
      i = fm;
    }
  }
  let prevBlank = true;
  while (i < b) {
    const t = lines[i]!.text;
    if (blank(t)) {
      i++;
      prevBlank = true;
      continue;
    }
    const fence = FENCE.exec(t);
    let j = i + 1;
    if (columns(t) - base >= 4 && prevBlank) {
      // Indented code: up to the last line still indented 4 (blank lines inside it included).
      let last = i;
      for (let k = i + 1; k < b; k++) {
        const u = lines[k]!.text;
        if (blank(u)) continue;
        if (columns(u) - base < 4) break;
        last = k;
      }
      j = last + 1;
      out.push(block(lines, 'code', i, j));
    } else if (fence) {
      const mark = fence[1]!;
      const close = new RegExp(`^[ \\t]*${mark[0] === '`' ? '`' : '~'}{${mark.length},}[ \\t]*$`);
      j = b;
      for (let k = i + 1; k < b; k++)
        if (close.test(lines[k]!.text)) {
          j = k + 1;
          break;
        }
      out.push(block(lines, 'code', i, j));
    } else if (MATH.test(t)) {
      // `$$ … $$` math: opaque until its closing `$$` (or one line when it closes on the same line).
      const rest = t.trimStart().slice(2);
      j = b;
      if (rest.includes('$$')) j = i + 1;
      else
        for (let k = i + 1; k < b; k++)
          if (lines[k]!.text.includes('$$')) {
            j = k + 1;
            break;
          }
      out.push(block(lines, 'raw', i, j));
    } else if (HEADING.test(t)) {
      out.push(block(lines, 'heading', i, j, { level: HEADING.exec(t)![1]!.length }));
    } else if (HR.test(t)) {
      out.push(block(lines, 'hr', i, j));
    } else if (QUOTE.test(t)) {
      while (j < b && QUOTE.test(lines[j]!.text)) j++;
      out.push(block(lines, CALLOUT.test(t) ? 'callout' : 'quote', i, j));
    } else if (listMark(t)) {
      j = listItem(lines, i, b, out);
    } else if (isTableStart(lines, i, b)) {
      j = i + 2;
      while (j < b && isRow(lines[j]!.text)) j++;
      out.push(block(lines, 'table', i, j));
    } else if (HTML.test(t)) {
      while (j < b && !blank(lines[j]!.text)) j++;
      out.push(block(lines, 'html', i, j));
    } else if (IMAGE_LINE.test(t) && (j >= b || blank(lines[j]!.text) || interrupts(lines, j, b))) {
      out.push(block(lines, 'image', i, j));
    } else if (LINK_DEF.test(t)) {
      out.push(block(lines, 'raw', i, j));
    } else {
      // Paragraph, or a setext heading when a `===` / `---` line underlines it.
      let setext = 0;
      for (; j < b; j++) {
        const u = lines[j]!.text;
        const m = SETEXT.exec(u);
        if (m) {
          setext = m[1]![0] === '=' ? 1 : 2;
          j++;
          break;
        }
        if (interrupts(lines, j, b)) break;
      }
      out.push(
        setext
          ? block(lines, 'heading', i, j, { level: setext, setext: true })
          : block(lines, 'paragraph', i, j),
      );
    }
    i = j;
    prevBlank = false;
  }
  return out;
}

/** A list item at line `i`: its first line, its lazy continuation text, and its nested lines as children. */
function listItem(lines: Line[], i: number, b: number, out: Block[]): number {
  const t = lines[i]!.text;
  const ind = t.length - t.trimStart().length;
  const m = listMark(t)!;
  const col = columns(t);
  const gap = m[2]!.length;
  // Content indentation: after the marker and its spaces (one space when there are more than four, or none).
  const content = col + m[1]!.length + (gap === 0 || gap > 4 ? 1 : gap);
  const rest = t.slice(ind + m[0].length);
  const kind: BlockKind = TASK.test(rest) ? 'task' : /\d/.test(m[1]![0]!) ? 'ordered' : 'bullet';
  // The item's own paragraph: following lines that don't start a block of their own.
  let head = i + 1;
  while (head < b && !interrupts(lines, head, b) && !(columns(lines[head]!.text) >= content + 4)) head++;
  let last = head - 1;
  for (let k = head; k < b; k++) {
    const u = lines[k]!.text;
    if (blank(u)) continue;
    if (columns(u) >= content) last = k;
    else break;
  }
  const item = block(lines, kind, i, last + 1);
  item.children = parseRange(lines, head, last + 1, content);
  out.push(item);
  return last + 1;
}

export function parseBlocks(src: string): Parsed {
  const lines = splitLines(src);
  return { src, lines, blocks: parseRange(lines, 0, lines.length, 0) };
}

export interface Located {
  block: Block;
  /** The container's blocks (the top level, or the parent item's children) and the block's index in them. */
  siblings: Block[];
  index: number;
  parent: Block | null;
}

/** The innermost block on line `lineNo` (0-based), or null on a blank line between blocks. */
export function blockAtLine(blocks: Block[], lineNo: number, parent: Block | null = null): Located | null {
  for (let index = 0; index < blocks.length; index++) {
    const b = blocks[index]!;
    if (lineNo < b.line || lineNo > b.lastLine) continue;
    if (lineNo > b.line) {
      const inner = blockAtLine(b.children, lineNo, b);
      if (inner) return inner;
    }
    return { block: b, siblings: blocks, index, parent };
  }
  return null;
}

/** Where `target` sits in the tree (same object identity as from `parseBlocks`). */
export function locate(blocks: Block[], target: Block, parent: Block | null = null): Located | null {
  const index = blocks.indexOf(target);
  if (index >= 0) return { block: target, siblings: blocks, index, parent };
  for (const b of blocks) {
    if (target.line <= b.line || target.lastLine > b.lastLine) continue;
    const inner = locate(b.children, target, b);
    if (inner) return inner;
  }
  return null;
}

/** The line number (0-based) of an offset. */
export function lineOf(lines: Line[], pos: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.from <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
