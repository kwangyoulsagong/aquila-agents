import type { SessionKind } from '@/shared/api';

/**
 * Scrollback rows per kind. Each row costs memory in every open terminal, so agents (whose full transcript the
 * CLI keeps anyway) get less than a shell, where scrollback is the only history.
 */
export const SCROLLBACK: Record<SessionKind, number> = {
  claude: 5000,
  codex: 5000,
  shell: 10000,
};

/** True when a proposed size differs from the current one (only then refit xterm and resize the pty). */
export function sizeChanged(
  current: { cols: number; rows: number },
  next: { cols: number; rows: number } | undefined,
): next is { cols: number; rows: number } {
  return (
    !!next &&
    Number.isFinite(next.cols) &&
    Number.isFinite(next.rows) &&
    next.cols > 0 &&
    next.rows > 0 &&
    (next.cols !== current.cols || next.rows !== current.rows)
  );
}
