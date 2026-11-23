import type { DiffFile, DiffLine } from '@/entities/diff';

// "Compare" in the changed-on-disk banner: what's on disk vs what's in the editor, as a unified diff for
// `DiffView`. Plain LCS over lines — notes are small; past `MAX` lines per side it gives up (null).

const MAX = 2000;
const CONTEXT = 3;

export function lineDiff(path: string, disk: string, mine: string): DiffFile | null {
  const a = disk.split(/\r\n?|\n/);
  const b = mine.split(/\r\n?|\n/);
  if (a.length > MAX || b.length > MAX) return null;
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..], one flat array.
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);

  const ops: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ kind: 'ctx', text: a[i]!, oldNo: ++i, newNo: ++j });
    else if (j < m && (i >= n || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!))
      ops.push({ kind: 'add', text: b[j]!, newNo: ++j });
    else ops.push({ kind: 'del', text: a[i]!, oldNo: ++i });
  }

  // Keep changed lines and CONTEXT lines around them, in hunks.
  const keep = ops.map(() => false);
  ops.forEach((o, k) => {
    if (o.kind === 'ctx') return;
    for (let x = Math.max(0, k - CONTEXT); x <= Math.min(ops.length - 1, k + CONTEXT); x++) keep[x] = true;
  });
  const lines: DiffLine[] = [];
  let hunks = 0;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) continue;
    if (k === 0 || !keep[k - 1]) {
      const o = ops[k]!;
      lines.push({ kind: 'hunk', text: `@@ -${o.oldNo ?? '…'} +${o.newNo ?? '…'} @@`, hunk: hunks });
      hunks++;
    }
    lines.push({ ...ops[k]!, hunk: hunks - 1 });
  }
  return { path, lines, hunks };
}
