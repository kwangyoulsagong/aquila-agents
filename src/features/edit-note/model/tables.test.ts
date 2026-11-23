import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { aligns, blankRow, cells, continueMarkup, newRow, nextCell, pipes, prevCell, tableLines } from './tables';

const TABLE = ['| a | b |', '|---|:-:|', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

const at = (doc: string, pos: number) =>
  EditorState.create({ doc, selection: EditorSelection.cursor(pos) });
const run = (cmd: typeof nextCell, state: EditorState) => {
  const tr = cmd(state);
  return tr ? { doc: tr.state.doc.toString(), head: tr.state.selection.main.head } : null;
};

describe('table parsing', () => {
  it('finds pipes outside code and escapes', () => {
    expect(pipes('| a `|` b \\| c | d |')).toEqual([0, 15, 19]);
  });
  it('reads cells and alignment', () => {
    expect(cells('| a | b \\| c |')).toEqual(['a', 'b | c']);
    expect(aligns('|:--|:-:|--:|---|')).toEqual(['left', 'center', 'right', null]);
  });
  it('finds the table around a line', () => {
    const lines = TABLE.split('\n');
    expect(tableLines((n) => lines[n - 1]!, lines.length, 3)).toEqual([1, 4]);
    expect(tableLines(() => '| no delimiter |', 1, 1)).toBeNull();
  });
  it('makes a blank row with the same cells', () => {
    expect(blankRow('  | a | b | c |')).toBe('  |  |  |  |');
  });
});

describe('table keys', () => {
  it('Tab moves to the next cell, then the next row, skipping the delimiter', () => {
    expect(run(nextCell, at(TABLE, 2))?.head).toBe(6);
    // Last cell of the header → first cell of the first body row.
    expect(run(nextCell, at(TABLE, 7))?.head).toBe(TABLE.indexOf('| 1') + 2);
  });
  it('Tab in the last cell adds a row without touching the others', () => {
    const r = run(nextCell, at(TABLE, TABLE.length - 2))!;
    expect(r.doc).toBe(`${TABLE}\n|  |  |`);
    expect(r.head).toBe(TABLE.length + 3);
  });
  it('Shift-Tab moves back', () => {
    expect(run(prevCell, at(TABLE, 6))?.head).toBe(2);
    expect(run(prevCell, at(TABLE, TABLE.indexOf('| 1') + 2))?.head).toBe(6);
  });
  it('Enter adds a row under the cursor; Enter on a blank last row leaves the table', () => {
    const r = run(newRow, at(TABLE, TABLE.indexOf('| 1') + 2))!;
    expect(r.doc.split('\n')[3]).toBe('|  |  |');
    const blank = `${TABLE}\n|  |  |`;
    expect(run(newRow, at(blank, blank.length - 1))!.doc).toBe(`${TABLE}\n`);
  });
  it('does nothing outside a table', () => {
    expect(nextCell(at('plain', 1))).toBeNull();
  });
});

describe('continueMarkup', () => {
  it('continues bullets, numbers and checkboxes without renumbering the rest', () => {
    expect(run(continueMarkup, at('- a', 3))?.doc).toBe('- a\n- ');
    expect(run(continueMarkup, at('1. a\n2. b', 4))?.doc).toBe('1. a\n2. \n2. b');
    expect(run(continueMarkup, at('- [x] done', 10))?.doc).toBe('- [x] done\n- [ ] ');
    expect(run(continueMarkup, at('> quote', 7))?.doc).toBe('> quote\n> ');
  });
  it('Enter on an empty item removes its marker', () => {
    expect(run(continueMarkup, at('- a\n- ', 6))?.doc).toBe('- a\n');
  });
  it('leaves plain lines to the default Enter', () => {
    expect(continueMarkup(at('text', 4))).toBeNull();
  });
});
