import type { DiffFile, DiffLine } from '@/entities/diff';

/** A review comment on one diff line. Anchored by path + side + line number so it survives a refresh. */
export interface LineComment {
  path: string;
  /** 'old' for a removed line (only the old file has it), else 'new'. */
  side: 'old' | 'new';
  line: number;
  /** The line's code without the +/-/space prefix. */
  code: string;
  text: string;
}

export type LineAnchor = Omit<LineComment, 'text'>;

/** Where a comment on this line points; null for lines without a number (hunk headers, notes). */
export function anchorOf(file: DiffFile, l: DiffLine | undefined): LineAnchor | null {
  if (!l) return null;
  if (l.kind === 'del' && l.oldNo !== undefined)
    return { path: file.path, side: 'old', line: l.oldNo, code: l.text.slice(1) };
  if ((l.kind === 'add' || l.kind === 'ctx') && l.newNo !== undefined)
    return { path: file.path, side: 'new', line: l.newNo, code: l.text.slice(1) };
  return null;
}

export const sameAnchor = (a: LineAnchor, b: LineAnchor) =>
  a.path === b.path && a.side === b.side && a.line === b.line;

/**
 * The prompt pasted into the session: an intro, then per comment `file:line`, the quoted code and the comment.
 * Sorted by file and line. No trailing newline — the user reviews it and presses Enter.
 */
export function buildReviewPrompt(
  comments: LineComment[],
  labels: { intro: string; removed: string },
): string {
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const blocks = sorted.map((c) => {
    const where = `${c.path}:${c.line}${c.side === 'old' ? ` ${labels.removed}` : ''}`;
    const quote = `> ${c.code.trim()}`;
    return [where, quote, c.text.trim()].join('\n');
  });
  return [labels.intro, ...blocks].join('\n\n');
}
