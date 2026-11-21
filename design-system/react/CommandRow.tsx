import type { ReactNode } from 'react';

export type CommandState = 'ok' | 'error' | 'interrupted' | 'pending';

/** Shape first, colour second (like `.c-dot`, T44): readable without telling green from red. */
const GLYPH: Record<CommandState, string> = { ok: '✓', error: '✕', interrupted: '■', pending: '…' };

/** `.c-commands` — a list of commands an agent ran (session commands timeline, T59), oldest first. */
export function CommandList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol className="c-commands" aria-label={label}>
      {children}
    </ol>
  );
}

/**
 * `.c-command[data-state]` — one command: how it ended (glyph, read out as `stateLabel`), the command on one
 * ellipsised mono line (full text on hover), optional marks (risk, badges) and the time.
 */
export function CommandRow({
  state,
  stateLabel,
  command,
  time,
  marks,
}: {
  state: CommandState;
  stateLabel: string;
  command: string;
  time?: string;
  marks?: ReactNode;
}) {
  return (
    <li className="c-command" data-state={state}>
      <span className="c-command__state" role="img" aria-label={stateLabel} title={stateLabel}>
        {GLYPH[state]}
      </span>
      <code className="c-command__text" title={command}>
        {command}
      </code>
      {marks}
      {time && <span className="c-command__time">{time}</span>}
    </li>
  );
}
