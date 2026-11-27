import { describe, expect, it } from 'vitest';
import { review, revertHunk, splitLines } from './review';

const revertAll = (seen: string, now: string) => {
  let text = now;
  // Last hunk first, so earlier hunks' line numbers stay valid.
  const r = review('n.md', seen, now)!;
  for (const h of [...r.hunks].reverse()) text = revertHunk(text, seen, h);
  return text;
};

describe('review', () => {
  it('is null for the same text, and for line endings only', () => {
    expect(review('n.md', 'a\nb\n', 'a\nb\n')).toBeNull();
    expect(review('n.md', 'a\nb\n', 'a\r\nb\r\n')).toBeNull();
  });

  it('counts added and removed lines', () => {
    const r = review('n.md', 'one\ntwo\nthree\n', 'one\nTWO\nthree\nfour\n')!;
    expect([r.added, r.removed]).toEqual([2, 1]);
    expect(r.file.lines.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['+TWO', '+four']);
    expect(r.file.lines.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['-two']);
  });

  it('splits far-apart changes into hunks with their spans', () => {
    const seen = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const now = seen.replace('l2\n', 'L2\n').replace('l25\n', 'l25\nnew\n');
    const r = review('n.md', seen, now)!;
    expect(r.hunks).toEqual([
      { oldFrom: 2, oldTo: 3, newFrom: 2, newTo: 3 },
      { oldFrom: 26, oldTo: 26, newFrom: 26, newTo: 27 },
    ]);
    expect(r.file.hunks).toBe(2);
  });

  it('handles a long note with one edit in the middle (trimmed, no full LCS)', () => {
    const seen = Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join('\n');
    const now = seen.replace('line 5000\n', 'line 5000 edited\n');
    const r = review('n.md', seen, now)!;
    expect([r.added, r.removed]).toEqual([1, 1]);
    expect(r.hunks).toEqual([{ oldFrom: 5000, oldTo: 5001, newFrom: 5000, newTo: 5001 }]);
  });
});

describe('revertHunk', () => {
  it('puts one hunk back and leaves the rest as it is now', () => {
    const seen = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n') + '\n';
    const now = seen.replace('l2\n', 'L2\n').replace('l25\n', 'l25\nnew\n');
    const r = review('n.md', seen, now)!;
    expect(revertHunk(now, seen, r.hunks[0]!)).toBe(seen.replace('l25\n', 'l25\nnew\n'));
    expect(revertHunk(now, seen, r.hunks[1]!)).toBe(seen.replace('l2\n', 'L2\n'));
  });

  it('keeps CRLF, restored lines included', () => {
    const seen = 'a\r\nb\r\nc\r\n';
    const now = 'a\r\nX\r\nY\r\nc\r\n';
    const r = review('n.md', seen, now)!;
    expect(revertHunk(now, seen, r.hunks[0]!)).toBe(seen);
  });

  it("restores lines in the current text's line ending and keeps other lines' own", () => {
    // Seen was LF, an agent rewrote it CRLF and changed a line: put back as CRLF.
    expect(revertAll('a\nb\nc\n', 'a\r\nB\r\nc\r\n')).toBe('a\r\nb\r\nc\r\n');
    // Mixed: only the reverted line's ending is chosen.
    expect(revertAll('a\nb\r\nc\n', 'a\nZ\r\nc\n')).toBe('a\nb\nc\n');
  });

  it('handles the ends of the text: added tail, removed tail, missing final newline', () => {
    expect(revertAll('a', 'a\nb')).toBe('a');
    expect(revertAll('a\nb', 'a')).toBe('a\nb');
    expect(revertAll('a\n', 'a')).toBe('a\n');
    expect(revertAll('x\ny\n', 'q\n')).toBe('x\ny\n');
    expect(revertAll('', 'new\n')).toBe('');
  });

  it('undoes every hunk of a real edit exactly', () => {
    const seen = '# Spec\n\n- [ ] REQ-1 login\n- [ ] REQ-2 logout\n\nNotes\n';
    const now = '# Spec\n\n- [x] REQ-1 login\n- [ ] REQ-2 logout\n- [ ] REQ-3 reset\n\nNotes\nmore\n';
    expect(revertAll(seen, now)).toBe(seen);
  });
});

describe('splitLines', () => {
  it('keeps every terminator', () => {
    expect(splitLines('a\r\nb\nc')).toEqual({ lines: ['a', 'b', 'c'], seps: ['\r\n', '\n'] });
    expect(splitLines('a\n')).toEqual({ lines: ['a', ''], seps: ['\n'] });
  });
});
