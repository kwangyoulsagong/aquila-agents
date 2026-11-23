import { describe, expect, it } from 'vitest';
import { lineDiff } from './lineDiff';

describe('lineDiff', () => {
  it('marks added and removed lines with context, in hunks', () => {
    const disk = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const mine = ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\r\n');
    const f = lineDiff('n.md', disk, mine)!;
    expect(f.hunks).toBe(2);
    expect(f.lines.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['b']);
    expect(f.lines.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['B', 'k']);
  });
  it('has no hunks for the same text', () => {
    expect(lineDiff('n.md', 'x\ny', 'x\r\ny')!.hunks).toBe(0);
  });
});
