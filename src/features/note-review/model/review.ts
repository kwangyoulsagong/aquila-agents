import type { DiffFile, DiffLine } from '@/entities/diff';

// "What changed since I last looked" (T80): the note as last seen vs as it is now, line by line. Common lines at
// the start and end are trimmed first (an agent usually edits a few places of a long spec), the middle goes through a
// plain LCS; past MAX lines in the middle it's one replaced block. Line endings don't count as a change.

const MAX = 2000;
const CONTEXT = 3;

/** One reviewable change: lines `[oldFrom, oldTo)` of the seen text became `[newFrom, newTo)` of the current one. */
export interface ReviewHunk {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

export interface Review {
  added: number;
  removed: number;
  /** For `DiffView` (hunk `i` of `file` is `hunks[i]`). */
  file: DiffFile;
  hunks: ReviewHunk[];
}

interface Lines {
  /** Line contents, without terminators (a text ending in a newline has a last empty line). */
  lines: string[];
  /** `seps[i]` ends `lines[i]` (one fewer than lines). */
  seps: string[];
}

export function splitLines(text: string): Lines {
  const parts = text.split(/(\r\n|\r|\n)/);
  const lines: string[] = [];
  const seps: string[] = [];
  parts.forEach((p, i) => (i % 2 ? seps : lines).push(p));
  return { lines, seps };
}

type Op = { kind: 'ctx' | 'add' | 'del'; text: string; a: number; b: number };

/** Edit script between two line lists; `a` / `b` are the indices of the line in each (the one it's at for the other). */
function ops(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf])
    suf++;
  const out: Op[] = [];
  for (let k = 0; k < pre; k++) out.push({ kind: 'ctx', text: a[k]!, a: k, b: k });
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  if (am.length > MAX || bm.length > MAX) {
    am.forEach((t, k) => out.push({ kind: 'del', text: t, a: pre + k, b: pre }));
    bm.forEach((t, k) => out.push({ kind: 'add', text: t, a: pre + am.length, b: pre + k }));
  } else {
    const n = am.length;
    const m = bm.length;
    const w = m + 1;
    const lcs = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * w + j] =
          am[i] === bm[j]
            ? lcs[(i + 1) * w + j + 1]! + 1
            : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j])
        out.push({ kind: 'ctx', text: am[i++]!, a: pre + i - 1, b: pre + j++ });
      else if (i < n && (j >= m || lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!))
        out.push({ kind: 'del', text: am[i++]!, a: pre + i - 1, b: pre + j });
      else out.push({ kind: 'add', text: bm[j++]!, a: pre + i, b: pre + j - 1 });
    }
  }
  for (let k = suf; k > 0; k--)
    out.push({ kind: 'ctx', text: a[a.length - k]!, a: a.length - k, b: b.length - k });
  return out;
}

/** The review of `seen` → `now`, or null when they're the same (line endings aside). */
export function review(path: string, seen: string, now: string): Review | null {
  const list = ops(splitLines(seen).lines, splitLines(now).lines);
  let added = 0;
  let removed = 0;
  for (const o of list) {
    if (o.kind === 'add') added++;
    else if (o.kind === 'del') removed++;
  }
  if (!added && !removed) return null;

  // Changed lines with CONTEXT lines around them; runs close enough to share context are one hunk.
  const keep = list.map(() => false);
  list.forEach((o, k) => {
    if (o.kind === 'ctx') return;
    for (let x = Math.max(0, k - CONTEXT); x <= Math.min(list.length - 1, k + CONTEXT); x++) keep[x] = true;
  });
  const lines: DiffLine[] = [];
  const hunks: ReviewHunk[] = [];
  for (let k = 0; k < list.length; k++) {
    if (!keep[k]) continue;
    const o = list[k]!;
    if (k === 0 || !keep[k - 1]) {
      lines.push({ kind: 'hunk', text: `@@ -${o.a + 1} +${o.b + 1} @@`, hunk: hunks.length });
      hunks.push({ oldFrom: -1, oldTo: -1, newFrom: -1, newTo: -1 });
    }
    const h = hunks[hunks.length - 1]!;
    if (o.kind !== 'ctx') {
      // The span from the hunk's first change to its last (context in between is the same on both sides).
      if (h.oldFrom < 0) {
        h.oldFrom = o.a;
        h.newFrom = o.b;
      }
      h.oldTo = o.kind === 'del' ? o.a + 1 : o.a;
      h.newTo = o.kind === 'add' ? o.b + 1 : o.b;
    }
    const prefix = o.kind === 'add' ? '+' : o.kind === 'del' ? '-' : ' ';
    lines.push({
      kind: o.kind,
      text: prefix + o.text,
      hunk: hunks.length - 1,
      ...(o.kind !== 'add' ? { oldNo: o.a + 1 } : {}),
      ...(o.kind !== 'del' ? { newNo: o.b + 1 } : {}),
    });
  }
  return { added, removed, hunks, file: { path, lines, hunks: hunks.length } };
}

/**
 * "Revert hunk": the current text with one hunk's lines put back as they were seen — only those lines change; every
 * other line keeps its bytes and line ending. Restored lines get the text's own line ending (CRLF stays CRLF).
 */
export function revertHunk(now: string, seen: string, h: ReviewHunk): string {
  const b = splitLines(now);
  const a = splitLines(seen);
  const eol = b.seps[0] ?? a.seps[0] ?? '\n';
  // Each line with its own ending (undefined: none yet — the text's own ending if it isn't last).
  const rows: { text: string; sep: string | undefined }[] = [
    ...b.lines.slice(0, h.newFrom).map((text, i) => ({ text, sep: b.seps[i] })),
    ...a.lines.slice(h.oldFrom, h.oldTo).map((text) => ({ text, sep: undefined })),
    ...b.lines.slice(h.newTo).map((text, i) => ({ text, sep: b.seps[h.newTo + i] })),
  ];
  return rows.map((r, i) => (i < rows.length - 1 ? r.text + (r.sep ?? eol) : r.text)).join('');
}
