import type { SessionKind } from '@/shared/api';

export const OPEN_ACTIONS = [
  { kind: 'claude', key: 'action.openClaude', kbd: '⌘T', primary: true },
  { kind: 'codex', key: 'action.openCodex', kbd: '⌘⇧T', primary: false },
  { kind: 'shell', key: 'action.openShell', kbd: '⌘⌥T', primary: false },
] as const satisfies readonly { kind: SessionKind; key: string; kbd: string; primary: boolean }[];
