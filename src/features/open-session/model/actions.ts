import type { SessionKind } from '@/shared/api';
import type { ShortcutId } from '@/shared/lib/shortcuts';

/** Buttons in a project's empty state. Shell has no button on purpose: shortcut only. */
export const OPEN_ACTIONS = [
  { kind: 'claude', key: 'action.openClaude', shortcut: 'openClaude', primary: true },
  { kind: 'codex', key: 'action.openCodex', shortcut: 'openCodex', primary: false },
] as const satisfies readonly { kind: SessionKind; key: string; shortcut: ShortcutId; primary: boolean }[];
