import type { SessionKind } from '@/shared/api';
import type { ShortcutId } from '@/shared/lib/shortcuts';

/** Buttons in a project's empty state. Shell has no button on purpose: shortcut only. */
export const OPEN_ACTIONS = [
  { kind: 'claude', key: 'action.openClaude', shortcut: 'openClaude', primary: true },
  { kind: 'codex', key: 'action.openCodex', shortcut: 'openCodex', primary: false },
] as const satisfies readonly { kind: SessionKind; key: string; shortcut: ShortcutId; primary: boolean }[];

/**
 * The empty state's buttons for a project: its default agent first and primary. Shell gets a button only when
 * it is the default.
 */
export function openActions(defaultAgent: SessionKind = 'claude') {
  const shell = { kind: 'shell', key: 'palette.openShell', shortcut: 'openShell', primary: false } as const;
  const all = defaultAgent === 'shell' ? [shell, ...OPEN_ACTIONS] : [...OPEN_ACTIONS];
  return all
    .map((a) => ({ ...a, primary: a.kind === defaultAgent }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}
