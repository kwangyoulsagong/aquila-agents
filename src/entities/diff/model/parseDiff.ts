export type DiffLineKind = 'hunk' | 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Line number in the old file (del, ctx). */
  oldNo?: number;
  /** Line number in the new file (add, ctx). */
  newNo?: number;
  /** Index of the hunk this line belongs to (the `@@` line included); undefined before the first hunk. */
  hunk?: number;
}

export interface DiffFile {
  /** New path (old path for a deletion). */
  path: string;
  oldPath?: string;
  lines: DiffLine[];
  /** Number of `@@` hunks. */
  hunks: number;
  isNew?: boolean;
  isDeleted?: boolean;
  binary?: boolean;
}

const HEADER = /^diff --git a\/(.*) b\/(.*)$/;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Strip `a/` / `b/` from a `---`/`+++` path; null for /dev/null. */
function headerPath(raw: string): string | null {
  const p = raw.replace(/\t.*$/, '');
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/**
 * Split `git diff --no-color` output into files. Header noise (index, mode, ---/+++) is dropped;
 * new/deleted/renamed/binary notes are kept as `meta` lines. Hunk lines carry old/new line numbers.
 */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;

  for (const line of text.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      file = { path: header[2], lines: [], hunks: 0 };
      if (header[1] !== header[2]) file.oldPath = header[1];
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    const hunk = file.hunks - 1;

    if (line.startsWith('@@')) {
      inHunk = true;
      const m = HUNK.exec(line);
      oldNo = Number(m?.[1] ?? 0);
      newNo = Number(m?.[2] ?? 0);
      file.lines.push({ kind: 'hunk', text: line, hunk: file.hunks++ });
    } else if (inHunk && line.startsWith('+')) {
      file.lines.push({ kind: 'add', text: line, newNo: newNo++, hunk });
    } else if (inHunk && line.startsWith('-')) {
      file.lines.push({ kind: 'del', text: line, oldNo: oldNo++, hunk });
    } else if (inHunk && line.startsWith(' ')) {
      file.lines.push({ kind: 'ctx', text: line, oldNo: oldNo++, newNo: newNo++, hunk });
    } else if (inHunk && line.startsWith('\\')) {
      file.lines.push({ kind: 'meta', text: line, hunk }); // "\ No newline at end of file"
    } else if (!inHunk && line.startsWith('--- ')) {
      const p = headerPath(line.slice(4));
      if (p && p !== file.path) file.oldPath = p;
    } else if (!inHunk && line.startsWith('+++ ')) {
      const p = headerPath(line.slice(4));
      if (p) file.path = p;
    } else if (/^(new file|deleted file|rename from|rename to|similarity|Binary files)/.test(line)) {
      if (line.startsWith('new file')) file.isNew = true;
      if (line.startsWith('deleted file')) file.isDeleted = true;
      if (line.startsWith('Binary files')) file.binary = true;
      file.lines.push({ kind: 'meta', text: line });
    }
  }
  // A deleted file's +++ is /dev/null: keep the old path, drop the self-reference.
  for (const f of files) if (f.oldPath === f.path) delete f.oldPath;
  return files;
}

/** One hunk of a modified file as a patch `git apply` accepts (stage with `--cached`, revert with `-R`). */
export function hunkPatch(file: DiffFile, hunk: number): string {
  const body = file.lines.filter((l) => l.hunk === hunk).map((l) => l.text);
  const from = file.oldPath ?? file.path;
  return [`diff --git a/${from} b/${file.path}`, `--- a/${from}`, `+++ b/${file.path}`, ...body, ''].join(
    '\n',
  );
}

/** A side-by-side row: old line on the left, new on the right; a hunk/meta line spans both (`full`). */
export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
  full?: DiffLine;
  /** Index of `left ?? right ?? full` in the file's lines (comments anchor to it). */
  index: number;
  rightIndex?: number;
}

/** Pair each run of deletions with the additions that follow it; context shows on both sides. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === 'del' || l.kind === 'add') {
      const dels: number[] = [];
      const adds: number[] = [];
      while (i < lines.length && lines[i].kind === 'del') dels.push(i++);
      while (i < lines.length && lines[i].kind === 'add') adds.push(i++);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const d = dels[k];
        const a = adds[k];
        rows.push({
          left: d === undefined ? undefined : lines[d],
          right: a === undefined ? undefined : lines[a],
          index: d ?? a,
          rightIndex: a,
        });
      }
    } else if (l.kind === 'ctx') {
      rows.push({ left: l, right: l, index: i, rightIndex: i });
      i++;
    } else {
      rows.push({ full: l, index: i });
      i++;
    }
  }
  return rows;
}
