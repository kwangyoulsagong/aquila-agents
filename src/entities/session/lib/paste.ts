// Safe paste (T40): text from the clipboard, a drop or a helper never reaches the pty with control characters in it.
// A pasted `ESC[201~` would end bracketed paste early and the rest would run as typed keys; other C0/C1 controls
// (Ctrl+C, Ctrl+D, ESC sequences, CSI 0x9b) can act on the CLI too. Tab and line breaks stay: xterm turns line
// breaks into Enter (CR) and brackets the paste when the CLI asked for it.
import type { Terminal } from '@xterm/xterm';

// C0 except tab (09), LF (0a), CR (0d); DEL; C1.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

/** `text` without the control characters that could act on the terminal; tab and line breaks kept. */
export function safePasteText(text: string): string {
  return text.replace(UNSAFE, '');
}

/** Pastes like ⌘V (bracketed when the CLI asked for it), after `safePasteText`. */
export function safePaste(term: Pick<Terminal, 'paste'>, text: string): void {
  const clean = safePasteText(text);
  if (clean) term.paste(clean);
}
