import { useSyncExternalStore } from 'react';
import type { Terminal } from '@xterm/xterm';
import { getTerminal, subscribeTerminals } from '../lib/terminalBus';

/** The mounted xterm of a session, or null until its TerminalView has mounted (and after it unmounts). */
export function useTerminal(id: string): Terminal | null {
  return useSyncExternalStore(subscribeTerminals, () => getTerminal(id));
}
