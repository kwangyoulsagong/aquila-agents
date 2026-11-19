export type DiffLineKind = 'hunk' | 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface DiffFile {
  /** New path (old path for a deletion). */
  path: string;
  oldPath?: string;
  lines: DiffLine[];
}

const HEADER = /^diff --git a\/(.*) b\/(.*)$/;

/** Strip `a/` / `b/` from a `---`/`+++` path; null for /dev/null. */
function headerPath(raw: string): string | null {
  const p = raw.replace(/\t.*$/, '');
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/**
 * Split `git diff --no-color` output into files. Header noise (index, mode, ---/+++) is dropped;
 * new/deleted/renamed/binary notes are kept as `meta` lines.
 */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let inHunk = false;

  for (const line of text.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      file = { path: header[2], lines: [] };
      if (header[1] !== header[2]) file.oldPath = header[1];
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;

    if (line.startsWith('@@')) {
      inHunk = true;
      file.lines.push({ kind: 'hunk', text: line });
    } else if (inHunk && line.startsWith('+')) {
      file.lines.push({ kind: 'add', text: line });
    } else if (inHunk && line.startsWith('-')) {
      file.lines.push({ kind: 'del', text: line });
    } else if (inHunk && line.startsWith(' ')) {
      file.lines.push({ kind: 'ctx', text: line });
    } else if (inHunk && line.startsWith('\\')) {
      file.lines.push({ kind: 'meta', text: line }); // "\ No newline at end of file"
    } else if (!inHunk && line.startsWith('--- ')) {
      const p = headerPath(line.slice(4));
      if (p && p !== file.path) file.oldPath = p;
    } else if (!inHunk && line.startsWith('+++ ')) {
      const p = headerPath(line.slice(4));
      if (p) file.path = p;
    } else if (/^(new file|deleted file|rename from|rename to|similarity|Binary files)/.test(line)) {
      file.lines.push({ kind: 'meta', text: line });
    }
  }
  // A deleted file's +++ is /dev/null: keep the old path, drop the self-reference.
  for (const f of files) if (f.oldPath === f.path) delete f.oldPath;
  return files;
}
