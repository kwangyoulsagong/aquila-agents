import { ChangeSet } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  slashInsert,
  stepTarget,
  turnInto,
  type Side,
  type TurnKind,
} from './blockEdits';
import { blockAtLine, parseBlocks } from './blocks';
import { applyChanges, docOf } from './serialize';

const at = (src: string, line: number) => {
  const p = parseBlocks(src);
  return { p, b: blockAtLine(p.blocks, line)!.block };
};

function move(src: string, line: number, targetLine: number, side: Side): string {
  const p = parseBlocks(src);
  const b = blockAtLine(p.blocks, line)!.block;
  const t = blockAtLine(p.blocks, targetLine)!.block;
  const r = moveBlock(p, b, t, side);
  return r ? applyEdits(src, r.changes) : src;
}

function step(src: string, line: number, dir: -1 | 1): string {
  const { p, b } = at(src, line);
  const s = stepTarget(p, b, dir);
  const r = s && moveBlock(p, b, s.target, s.side);
  return r ? applyEdits(src, r.changes) : src;
}

const turn = (src: string, line: number, kind: TurnKind) => {
  const { p, b } = at(src, line);
  return applyEdits(src, turnInto(p, b, kind));
};

describe('moveBlock', () => {
  it('swaps paragraphs, keeping the blank line between them', () => {
    expect(move('A\n\nB\n\nC', 4, 0, 'before')).toBe('C\n\nA\n\nB');
    expect(move('A\n\nB\n\nC\n', 0, 4, 'after')).toBe('B\n\nC\n\nA\n');
    expect(move('A\n\nB\n\nC', 0, 2, 'after')).toBe('B\n\nA\n\nC');
  });

  it('moves a list item with its children inside a tight list', () => {
    const src = '- a\n  - a1\n- b\n- c\n';
    expect(move(src, 0, 3, 'after')).toBe('- b\n- c\n- a\n  - a1\n');
    expect(move(src, 3, 0, 'before')).toBe('- c\n- a\n  - a1\n- b\n');
  });

  it('keeps a loose list loose and a tight list tight', () => {
    expect(step('# H\n\n- a\n\n- b\n\n- c\n', 6, -1)).toBe('# H\n\n- a\n\n- c\n\n- b\n');
    expect(step('# H\n\n- a\n- b\n', 3, -1)).toBe('# H\n\n- b\n- a\n');
  });

  it('moves nested items with CRLF', () => {
    expect(step('- a\r\n  - x\r\n  - y\r\n', 2, -1)).toBe('- a\r\n  - y\r\n  - x\r\n');
  });

  it('reindents a block moved into or out of a nested list', () => {
    expect(move('- a\n  - a1\n- b\n', 2, 1, 'after')).toBe('- a\n  - a1\n  - b\n');
    expect(move('- a\n  - a1\n- b\n', 1, 2, 'after')).toBe('- a\n- b\n- a1\n');
  });

  it('keeps a list item apart from a paragraph it lands next to', () => {
    expect(move('- x\n- y\n\nB', 1, 3, 'after')).toBe('- x\n\nB\n\n- y');
    expect(move('para\n\n- x\n- y', 0, 3, 'after')).toBe('- x\n- y\n\npara');
  });

  it('is a no-op where the block already is, or into itself', () => {
    expect(move('A\n\nB', 2, 0, 'after')).toBe('A\n\nB');
    expect(move('A\n\nB', 0, 2, 'before')).toBe('A\n\nB');
    expect(move('- a\n  - b', 0, 1, 'after')).toBe('- a\n  - b');
  });

  it('never moves frontmatter or puts a block above it', () => {
    expect(move('---\nt: 1\n---\n\nA\n\nB', 6, 0, 'before')).toBe('---\nt: 1\n---\n\nA\n\nB');
  });

  it('keeps CRLF and leaves the rest byte-identical', () => {
    const src = 'keep  \r\n\r\n# H\r\n\r\n- a\r\n- b\r\n\r\ntail\t\r\n';
    const out = step(src, 5, -1);
    expect(out).toBe('keep  \r\n\r\n# H\r\n\r\n- b\r\n- a\r\n\r\ntail\t\r\n');
  });

  it('round-trips through CodeMirror and the byte-exact save with CRLF', () => {
    const original = 'one\r\n\r\ntwo\r\n\r\nthree\r\n';
    const doc = docOf(original);
    const src = doc.toString(); // CodeMirror's view of it: `\n`
    const p = parseBlocks(src);
    const r = moveBlock(p, blockAtLine(p.blocks, 4)!.block, blockAtLine(p.blocks, 0)!.block, 'before')!;
    const saved = applyChanges(original, ChangeSet.of(r.changes, doc.length));
    expect(saved).toBe('three\r\n\r\none\r\n\r\ntwo\r\n');
  });

  it('maps the cursor into the moved block', () => {
    const src = 'A\n\nBcd\n\nE';
    const p = parseBlocks(src);
    const r = moveBlock(p, blockAtLine(p.blocks, 2)!.block, blockAtLine(p.blocks, 0)!.block, 'before')!;
    const out = applyEdits(src, r.changes);
    expect(out).toBe('Bcd\n\nA\n\nE');
    expect(r.map(5)).toBe(2); // after "Bc"
  });
});

describe('stepTarget (⌥⇧↑↓)', () => {
  it('moves among siblings and stops at the edges', () => {
    expect(step('- a\n- b\n- c', 1, -1)).toBe('- b\n- a\n- c');
    expect(step('- a\n- b\n- c', 1, 1)).toBe('- a\n- c\n- b');
    expect(step('- a\n- b', 0, -1)).toBe('- a\n- b');
    expect(step('- a\n  - x\n  - y\n- b', 2, -1)).toBe('- a\n  - y\n  - x\n- b');
  });
});

describe('duplicate / delete', () => {
  it('duplicates under itself with the same gap', () => {
    const a = at('# H\n\npara\n\nend', 2);
    expect(applyEdits(a.p.src, duplicateBlock(a.p, a.b))).toBe('# H\n\npara\n\npara\n\nend');
    const b = at('- a\n  - c\n- b', 0);
    expect(applyEdits(b.p.src, duplicateBlock(b.p, b.b))).toBe('- a\n  - c\n- a\n  - c\n- b');
    const c = at('only', 0);
    expect(applyEdits(c.p.src, duplicateBlock(c.p, c.b))).toBe('only\n\nonly');
  });

  it('deletes with the smaller gap, so its neighbours stay apart', () => {
    const a = at('A\n\n- x\n- y\n\nB', 3);
    expect(applyEdits(a.p.src, deleteBlock(a.p, a.b))).toBe('A\n\n- x\n\nB');
    const b = at('A\n\nB\n\nC', 4);
    expect(applyEdits(b.p.src, deleteBlock(b.p, b.b))).toBe('A\n\nB');
    const c = at('- a\n\n  - b\n\nP', 2);
    expect(applyEdits(c.p.src, deleteBlock(c.p, c.b))).toBe('- a\n\nP');
  });
});

describe('turnInto', () => {
  it('swaps only the first line marker', () => {
    expect(turn('Hello', 0, 'h2')).toBe('## Hello');
    expect(turn('## Hello', 0, 'paragraph')).toBe('Hello');
    expect(turn('## Hello', 0, 'h1')).toBe('# Hello');
    expect(turn('* item', 0, 'task')).toBe('* [ ] item');
    expect(turn('- [x] done', 0, 'bullet')).toBe('- done');
    expect(turn('- [x] done', 0, 'ordered')).toBe('1. done');
    expect(turn('3) item', 0, 'bullet')).toBe('- item');
    expect(turn('  - nested', 0, 'h3')).toBe('  ### nested');
  });

  it('keeps children and other lines untouched', () => {
    expect(turn('- a\n  - b\n\nrest', 0, 'task')).toBe('- [ ] a\n  - b\n\nrest');
  });

  it('quotes every line and unquotes them', () => {
    expect(turn('one\ntwo', 0, 'quote')).toBe('> one\n> two');
    expect(turn('# Title', 0, 'quote')).toBe('> Title');
    expect(turn('> one\n> two', 0, 'paragraph')).toBe('one\ntwo');
    expect(turn('> one\n>two', 0, 'bullet')).toBe('- one\ntwo');
    expect(turn('> [!NOTE]\n> body', 0, 'paragraph')).toBe('body');
    expect(turn('> [!TIP] Title\n> body', 0, 'quote')).toBe('> Title\n> body');
  });

  it('handles setext headings', () => {
    expect(turn('Title\n===', 0, 'h2')).toBe('Title\n---');
    expect(turn('Title\n===\n\nx', 0, 'paragraph')).toBe('Title\n\nx');
    expect(turn('Title\n---', 0, 'h3')).toBe('### Title');
  });

  it('leaves code, tables and frontmatter alone', () => {
    expect(turn('```\nx\n```', 0, 'h1')).toBe('```\nx\n```');
    expect(turn('| a |\n| - |', 0, 'quote')).toBe('| a |\n| - |');
  });

  it('keeps CRLF on every line it touches', () => {
    expect(turn('a\r\nb\r\n', 0, 'quote')).toBe('> a\r\n> b\r\n');
    expect(turn('> a\r\n> b\r\n', 0, 'paragraph')).toBe('a\r\nb\r\n');
  });
});

describe('slashInsert', () => {
  const run = (src: string, kind: Parameters<typeof slashInsert>[4]) => {
    const slash = src.indexOf('/');
    const end = src.indexOf('|');
    const clean = src.replace('|', '');
    const p = parseBlocks(clean);
    const r = slashInsert(clean, p.lines, slash, end, kind);
    const out = applyEdits(clean, [r.change]);
    return out.slice(0, r.cursor) + '|' + out.slice(r.cursor);
  };

  it('replaces only the /query', () => {
    expect(run('a\n\n/he|\n\nb', 'h2')).toBe('a\n\n## |\n\nb');
    expect(run('  /to|', 'task')).toBe('  - [ ] |');
    expect(run('/|', 'link')).toBe('[[|');
  });

  it('inserts multi-line items with the file line ending', () => {
    expect(run('x\r\n\r\n/code|', 'code')).toBe('x\r\n\r\n```\r\n|\r\n```');
    expect(run('/c|', 'callout')).toBe('> [!NOTE]\n> |');
    expect(run('/t|', 'table')).toBe('| | |  |\n| --- | --- |\n|  |  |');
  });

  it('keeps a divider from underlining the text above', () => {
    expect(run('text\n/d|', 'divider')).toBe('text\n\n---\n|');
    expect(run('text\n\n/d|', 'divider')).toBe('text\n\n---\n|');
  });
});
