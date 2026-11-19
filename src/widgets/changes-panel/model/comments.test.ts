import { describe, expect, it } from 'vitest';
import { parseDiff } from '@/entities/diff';
import { anchorOf, buildReviewPrompt, type LineComment } from './comments';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,3 @@
 const keep = 1;
-const old = 2;
+const next = 3;
`;

describe('anchorOf', () => {
  it('anchors removed lines to the old file and others to the new one', () => {
    const [f] = parseDiff(DIFF);
    expect(anchorOf(f, f.lines[0])).toBeNull(); // @@
    expect(anchorOf(f, f.lines[1])).toEqual({
      path: 'src/a.ts',
      side: 'new',
      line: 10,
      code: 'const keep = 1;',
    });
    expect(anchorOf(f, f.lines[2])).toEqual({
      path: 'src/a.ts',
      side: 'old',
      line: 11,
      code: 'const old = 2;',
    });
    expect(anchorOf(f, f.lines[3])).toMatchObject({ side: 'new', line: 11 });
  });
});

describe('buildReviewPrompt', () => {
  it('lists file:line, the quoted code and the comment, sorted', () => {
    const comments: LineComment[] = [
      { path: 'src/b.ts', side: 'new', line: 3, code: '  return x;', text: 'Handle null here.' },
      { path: 'src/a.ts', side: 'old', line: 11, code: 'const old = 2;', text: 'Why was this removed?\n' },
    ];
    expect(buildReviewPrompt(comments, { intro: 'Review:', removed: '(removed line)' })).toBe(
      [
        'Review:',
        'src/a.ts:11 (removed line)\n> const old = 2;\nWhy was this removed?',
        'src/b.ts:3\n> return x;\nHandle null here.',
      ].join('\n\n'),
    );
  });
});
