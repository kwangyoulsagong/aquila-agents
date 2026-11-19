import { describe, expect, it } from 'vitest';
import { parseDiff } from './parseDiff';

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
    expect(untracked[0].lines.at(-1)).toEqual({ kind: 'add', text: '+x' });
  });

  it('returns nothing for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });
});
