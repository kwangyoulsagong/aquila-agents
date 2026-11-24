// Safe paste (T40): text from the clipboard, a drop or a helper never reaches the pty with control characters in it.
// A pasted `ESC[201~` would end bracketed paste early and the rest would run as typed keys; other C0/C1 controls
// (Ctrl+C, Ctrl+D, ESC sequences, CSI 0x9b) can act on the CLI too. Tab and line breaks stay: xterm turns line
// breaks into Enter (CR) and brackets the paste when the CLI asked for it.
import type { Terminal } from '@xterm/xterm';
import { safePasteText } from '@/shared/lib/pasteText';

export { safePasteText };

/** Pastes like ⌘V (bracketed when the CLI asked for it), after `safePasteText`. */
export function safePaste(term: Pick<Terminal, 'paste'>, text: string): void {
  const clean = safePasteText(text);
  if (clean) term.paste(clean);
}
