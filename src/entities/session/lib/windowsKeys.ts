// Windows terminal keys (T19): Ctrl+C copies when there is a selection (and clears it), otherwise it stays SIGINT.
// Ctrl+V is left alone: xterm pastes text and the CLIs read images themselves (Claude on Windows uses Alt+V).
import type { KeyLike } from './imeGuard';

export interface Selection {
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
}

/** xterm custom key handler part: false = handled here (copied), xterm must not send ^C. */
export function windowsCopyKey(e: KeyLike, sel: Selection, copy: (text: string) => void): boolean {
  if (e.type !== 'keydown' || e.code !== 'KeyC' || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey)
    return true;
  if (!sel.hasSelection()) return true;
  copy(sel.getSelection());
  sel.clearSelection();
  e.preventDefault?.();
  return false;
}
