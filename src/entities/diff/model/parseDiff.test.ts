import { describe, expect, it } from 'vitest';
import { hunkPatch, parseDiff, toSplitRows } from './parseDiff';

const SAMPLE = `diff --git a/src/api.ts b/src/api.ts
index 1111111..2222222 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 3333333..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
\\ No newline at end of file
diff --git a/notes/new file.md b/notes/new file.md
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/notes/new file.md
@@ -0,0 +1 @@
+hello
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

describe('parseDiff', () => {
  it('splits files and classifies lines', () => {
    const files = parseDiff(SAMPLE);
    expect(files.map((f) => f.path)).toEqual(['src/api.ts', 'old.txt', 'notes/new file.md', 'img.png']);
    expect(files[0].lines.map((l) => l.kind)).toEqual(['hunk', 'ctx', 'del', 'add', 'add', 'ctx']);
    expect(files[0].oldPath).toBeUndefined();
  });

  it('keeps new/deleted/binary notes and the no-newline marker as meta', () => {
    const [, deleted, added, binary] = parseDiff(SAMPLE);
    expect(deleted.lines.map((l) => l.kind)).toEqual(['meta', 'hunk', 'del', 'meta']);
    expect(added.lines[0]).toEqual({ kind: 'meta', text: 'new file mode 100644' });
    expect(binary.lines).toEqual([{ kind: 'meta', text: 'Binary files a/img.png and b/img.png differ' }]);
  });

  it('records renames and parses --no-index diffs of untracked files', () => {
    const rename = parseDiff(
      'diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n',
    );
    expect(rename[0]).toMatchObject({ path: 'b.ts', oldPath: 'a.ts' });

    const untracked = parseDiff(
      'diff --git a/todo.md b/todo.md\nnew file mode 100644\n--- /dev/null\n+++ b/todo.md\n@@ -0,0 +1 @@\n+x\n',
    );
    expect(untracked[0].path).toBe('todo.md');
    expect(untracked[0].lines.at(-1)).toEqual({ kind: 'add', text: '+x', newNo: 1, hunk: 0 });
  });

  it('returns nothing for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

describe('line numbers and hunks', () => {
  it('numbers old/new lines from the hunk header', () => {
    const [api, deleted, added] = parseDiff(SAMPLE);
    expect(api.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['hunk', undefined, undefined],
      ['ctx', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['ctx', 3, 4],
    ]);
    expect(api.hunks).toBe(1);
    expect(deleted.isDeleted).toBe(true);
    expect(added.isNew).toBe(true);
  });

  it('builds a patch for one hunk', () => {
    const two = parseDiff(
      'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10,2 +10,2 @@\n j\n-k\n+K\n',
    )[0];
    expect(two.hunks).toBe(2);
    expect(hunkPatch(two, 1)).toBe(
      'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -10,2 +10,2 @@\n j\n-k\n+K\n',
    );
  });
});

describe('toSplitRows', () => {
  it('pairs deletions with the additions after them', () => {
    const [api] = parseDiff(SAMPLE);
    const rows = toSplitRows(api.lines);
    expect(rows.map((r) => [r.full?.kind, r.left?.text, r.right?.text])).toEqual([
      ['hunk', undefined, undefined],
      [undefined, ' const a = 1;', ' const a = 1;'],
      [undefined, '-const b = 2;', '+const b = 3;'],
      [undefined, undefined, '+const c = 4;'],
      [undefined, ' export { a };', ' export { a };'],
    ]);
    expect(rows[3].index).toBe(4);
  });
});
