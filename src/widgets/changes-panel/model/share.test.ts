import { describe, expect, it } from 'vitest';
import { parseDiff } from '@/entities/diff';
import { buildShareMarkdown, lineCounts, type ShareLabels } from './share';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@
 const keep = 1;
-const old = 2;
+const next = 3;
+const more = 4;
diff --git a/prisma/schema.prisma b/prisma/schema.prisma
--- a/prisma/schema.prisma
+++ b/prisma/schema.prisma
@@ -1,1 +1,1 @@
-model A {}
+model B {}
`;

const LABELS: ShareLabels = {
  title: 'What changed',
  files: '2 files',
  file: 'File',
  note: 'Note',
  risky: 'Check first',
  comments: 'Review notes',
  removed: '(removed line)',
  truncated: 'Diff was cut.',
  status: { M: 'Modified', A: 'Added' },
};

describe('lineCounts', () => {
  it('counts added and removed lines per file', () => {
    const counts = lineCounts(parseDiff(DIFF));
    expect(counts.get('src/a.ts')).toEqual({ add: 2, del: 1 });
    expect(counts.get('prisma/schema.prisma')).toEqual({ add: 1, del: 1 });
  });
});

describe('buildShareMarkdown', () => {
  const base = {
    project: 'web',
    branch: 'feat/x',
    source: 'Working tree',
    files: [
      { path: 'prisma/schema.prisma', status: 'M', risk: 'Migration' },
      { path: 'src/a.ts', status: 'M' },
    ],
    diff: parseDiff(DIFF),
    comments: [],
  };

  it('writes a heading, totals, risky files and a table', () => {
    const md = buildShareMarkdown(base, LABELS);
    expect(md).toContain('## What changed · web · `feat/x`');
    expect(md).toContain('Working tree · 2 files · +3 −2');
    expect(md).toContain('**Check first:** `prisma/schema.prisma` (Migration)');
    expect(md).toContain('| Modified | `prisma/schema.prisma` | 1 | 1 | Migration |');
    expect(md).toContain('| Modified | `src/a.ts` | 2 | 1 |  |');
    expect(md).not.toContain('Review notes');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('lists comments sorted, marks removed lines, notes truncation', () => {
    const md = buildShareMarkdown(
      {
        ...base,
        truncated: true,
        comments: [
          { path: 'src/a.ts', side: 'new', line: 12, code: 'x', text: 'rename\nthis' },
          { path: 'prisma/schema.prisma', side: 'old', line: 1, code: 'y', text: 'why?' },
        ],
      },
      LABELS,
    );
    const notes = md.slice(md.indexOf('### Review notes'));
    expect(notes).toContain(
      '- `prisma/schema.prisma:1` (removed line) — why?\n- `src/a.ts:12` — rename this',
    );
    expect(md).toContain('_Diff was cut._');
  });

  it('escapes pipes and backticks in paths, shows renames', () => {
    const md = buildShareMarkdown(
      {
        ...base,
        files: [{ path: 'a|b`.ts', origPath: 'old.ts', status: 'R' }],
        diff: [],
      },
      LABELS,
    );
    expect(md).toContain('| R | `old.ts` → `` a\\|b`.ts `` |  |  |  |');
    expect(md).not.toContain('Check first');
  });
});
