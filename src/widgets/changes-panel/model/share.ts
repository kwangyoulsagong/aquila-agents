import type { DiffFile } from '@/entities/diff';
import type { LineComment } from './comments';

/** One row of the shared summary. */
export interface ShareFile {
  path: string;
  origPath?: string;
  /** One letter: M A D R C U ?. */
  status: string;
  /** Translated risk label ("Migration"), when the file is risky (T57). */
  risk?: string;
}

export interface ShareLabels {
  /** "What changed" */
  title: string;
  /** "{count} files" with `{count}` replaced by the caller. */
  files: string;
  file: string;
  note: string;
  /** "Files to check first" */
  risky: string;
  /** "Review notes" */
  comments: string;
  /** "(removed line)" */
  removed: string;
  /** "Diff was cut at 400 KB; counts are partial." */
  truncated: string;
  /** Status letter → word ("Modified"). Unknown letters show as-is. */
  status: Record<string, string>;
}

export interface ShareInput {
  project: string;
  branch?: string;
  /** "Working tree" / "Since session start (abc1234)" / remote host — already translated. */
  source: string;
  files: readonly ShareFile[];
  /** Parsed diff, for per-file +/- counts. */
  diff: readonly DiffFile[];
  comments: readonly LineComment[];
  truncated?: boolean;
}

/** Added / removed line counts per path (binary files have none). */
export function lineCounts(diff: readonly DiffFile[]): Map<string, { add: number; del: number }> {
  const out = new Map<string, { add: number; del: number }>();
  for (const f of diff) {
    let add = 0;
    let del = 0;
    for (const l of f.lines) {
      if (l.kind === 'add') add++;
      else if (l.kind === 'del') del++;
    }
    out.set(f.path, { add, del });
  }
  return out;
}

/** Inline code that survives backticks and table pipes in a path. */
const code = (s: string) => {
  const ticks = s.includes('`') ? '``' : '`';
  const pad = ticks.length > 1 ? ' ' : '';
  return `${ticks}${pad}${s.replace(/\|/g, '\\|')}${pad}${ticks}`;
};
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * "Share what changed": a Markdown summary for a PR body, a chat or a ticket — heading, totals, a file table
 * (risky files first, as in the panel) and the line comments, if any. Plain text only: no file contents, no paths
 * outside the repo.
 */
export function buildShareMarkdown(input: ShareInput, labels: ShareLabels): string {
  const counts = lineCounts(input.diff);
  let add = 0;
  let del = 0;
  for (const c of counts.values()) {
    add += c.add;
    del += c.del;
  }
  const head = `## ${labels.title} · ${input.project}${input.branch ? ` · ${code(input.branch)}` : ''}`;
  const totals = [input.source, labels.files, `+${add} −${del}`].join(' · ');
  const out = [head, '', totals];

  const risky = input.files.filter((f) => f.risk);
  if (risky.length) {
    out.push('', `**${labels.risky}:** ${risky.map((f) => `${code(f.path)} (${f.risk})`).join(', ')}`);
  }

  if (input.files.length) {
    out.push('', `| | ${labels.file} | + | − | ${labels.note} |`, '|---|---|--:|--:|---|');
    for (const f of input.files) {
      const c = counts.get(f.path);
      const name = f.origPath ? `${code(f.origPath)} → ${code(f.path)}` : code(f.path);
      const status = labels.status[f.status] ?? f.status;
      out.push(
        `| ${cell(status)} | ${name} | ${c ? c.add : ''} | ${c ? c.del : ''} | ${f.risk ? cell(f.risk) : ''} |`,
      );
    }
  }

  if (input.comments.length) {
    out.push('', `### ${labels.comments}`, '');
    const sorted = [...input.comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    for (const c of sorted) {
      const where = code(`${c.path}:${c.line}`) + (c.side === 'old' ? ` ${labels.removed}` : '');
      out.push(`- ${where} — ${c.text.trim().replace(/\r?\n/g, ' ')}`);
    }
  }

  if (input.truncated) out.push('', `_${labels.truncated}_`);
  return out.join('\n') + '\n';
}
