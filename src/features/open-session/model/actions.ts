import type { SessionKind } from '@/shared/api';

/** Buttons in a project's empty state. Shell has no button on purpose: ⌘⌥T only. */
export const OPEN_ACTIONS = [
  { kind: 'claude', key: 'action.openClaude', kbd: '⌘T', primary: true },
  { kind: 'codex', key: 'action.openCodex', kbd: '⌘⇧T', primary: false },
] as const satisfies readonly { kind: SessionKind; key: string; kbd: string; primary: boolean }[];
