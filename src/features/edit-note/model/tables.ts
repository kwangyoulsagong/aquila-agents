import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state';

// Table editing (Tab / Shift-Tab / Enter) without auto-format: the cursor jumps between cells and new rows are
// added, but no existing cell is padded or aligned — untouched lines never change.

/** Offsets of the cell separators (`|` not escaped, not inside `code`) in a table line. */
export function pipes(line: string): number[] {
  const out: number[] = [];
  let code = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (c === '`') code = !code;
    else if (c === '|' && !code) out.push(i);
  }
  return out;
}

export const isRow = (line: string) => /^\s*\|/.test(line) && pipes(line).length >= 2;
export const isDelimiter = (line: string) =>
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-');

/** Line numbers (1-based, inclusive) of the table around `lineNo`, or null when it isn't in a table. */
export function tableLines(
  lineAt: (n: number) => string,
  lines: number,
  lineNo: number,
): [number, number] | null {
  if (!isRow(lineAt(lineNo))) return null;
  let from = lineNo;
  let to = lineNo;
  while (from > 1 && isRow(lineAt(from - 1))) from--;
  while (to < lines && isRow(lineAt(to + 1))) to++;
  // A table needs its delimiter row right under the header.
  return to > from && isDelimiter(lineAt(from + 1)) ? [from, to] : null;
}

/** Where a cell's text starts: after the `|` and one space when there is one. */
function cellStart(line: string, pipe: number): number {
  return line[pipe + 1] === ' ' ? pipe + 2 : pipe + 1;
}

/** A blank row with as many cells as `line`, indented the same. */
export function blankRow(line: string): string {
  const indent = /^\s*/.exec(line)![0];
  const cells = Math.max(1, pipes(line).length - 1);
  return `${indent}|${'  |'.repeat(cells)}`;
}

const rowIsBlank = (line: string) => line.replace(/[|\s]/g, '') === '';

type Command = (state: EditorState) => Transaction | null;

/** Tab: the next cell (the next row's first cell after the last; a new row after the last row). */
export const nextCell: Command = (state) => {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const range = tableLines((n) => state.doc.line(n).text, state.doc.lines, line.number);
  if (!range) return null;
  const col = sel.head - line.from;
  const ps = pipes(line.text);
  const next = ps.find((p, i) => p >= col && i < ps.length - 1);
  if (next !== undefined)
    return state.update({ selection: { anchor: line.from + cellStart(line.text, next) } });
  let n = line.number + 1;
  if (n <= range[1] && isDelimiter(state.doc.line(n).text)) n++;
  if (n <= range[1]) {
    const target = state.doc.line(n);
    const first = pipes(target.text)[0]!;
    return state.update({ selection: { anchor: target.from + cellStart(target.text, first) } });
  }
  const row = blankRow(line.text);
  const insert = state.lineBreak + row;
  return state.update({
    changes: { from: line.to, insert },
    selection: { anchor: line.to + state.lineBreak.length + cellStart(row, pipes(row)[0]!) },
    userEvent: 'input',
  });
};

/** Shift-Tab: the previous cell. */
export const prevCell: Command = (state) => {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const range = tableLines((n) => state.doc.line(n).text, state.doc.lines, line.number);
  if (!range) return null;
  const col = sel.head - line.from;
  const ps = pipes(line.text);
  // Cell i lies between pipe i and pipe i + 1.
  const current = ps.filter((p) => p < col).length - 1;
  if (current >= 1)
    return state.update({ selection: { anchor: line.from + cellStart(line.text, ps[current - 1]!) } });
  let n = line.number - 1;
  if (n >= range[0] && isDelimiter(state.doc.line(n).text)) n--;
  if (n < range[0]) return state.update({});
  const target = state.doc.line(n);
  const tp = pipes(target.text);
  return state.update({ selection: { anchor: target.from + cellStart(target.text, tp[tp.length - 2]!) } });
};

/** Enter in a table row: a new blank row under it. Enter on a blank last row leaves the table (the row goes). */
export const newRow: Command = (state) => {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const line = state.doc.lineAt(sel.head);
  const range = tableLines((n) => state.doc.line(n).text, state.doc.lines, line.number);
  if (!range || line.number === range[0] + 1) return null;
  if (line.number === range[1] && rowIsBlank(line.text) && line.number > range[0] + 1)
    return state.update({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: EditorSelection.cursor(line.from),
      userEvent: 'delete',
    });
  const row = blankRow(line.text);
  return state.update({
    changes: { from: line.to, insert: state.lineBreak + row },
    selection: { anchor: line.to + state.lineBreak.length + cellStart(row, pipes(row)[0]!) },
    userEvent: 'input',
  });
};

/** Cells of a row, trimmed (for the rendered table). */
export function cells(line: string): string[] {
  const ps = pipes(line);
  const out: string[] = [];
  for (let i = 0; i < ps.length - 1; i++) out.push(line.slice(ps[i]! + 1, ps[i + 1]).trim());
  // A row without a closing pipe: the rest is the last cell.
  const tail = line.slice(ps[ps.length - 1]! + 1).trim();
  if (tail) out.push(tail);
  return out.map((c) => c.replace(/\\\|/g, '|'));
}

/** Column alignment from the delimiter row. */
export function aligns(delimiter: string): ('left' | 'center' | 'right' | null)[] {
  return delimiter
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => {
      const s = c.trim();
      const l = s.startsWith(':');
      const r = s.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
    });
}

const LIST = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?/;
const QUOTE = /^(\s*(?:>\s?)+)/;

/**
 * Enter in a list item or quote: the next line gets the same marker (number + 1, an open checkbox, `> `). Enter on
 * an empty item removes its marker instead. Only the cursor's line and the new one change — the next items are
 * never renumbered (Markdown's own continuation does that).
 */
export const continueMarkup: Command = (state) => {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const line = state.doc.lineAt(sel.head);
  const list = LIST.exec(line.text);
  const quote = list ? null : QUOTE.exec(line.text);
  const marker = list?.[0] ?? quote?.[0];
  if (!marker || sel.head - line.from < marker.length) return null;
  if (line.text.slice(marker.length).trim() === '' && sel.head === line.to)
    return state.update({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from },
      userEvent: 'delete',
    });
  let next: string;
  if (list) {
    const [, indent, bullet, num, delim, space, task] = list;
    next = `${indent}${bullet ?? `${Number(num) + 1}${delim}`}${space}${task ? '[ ] ' : ''}`;
  } else next = quote![1]!;
  const insert = state.lineBreak + next;
  return state.update({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
};
