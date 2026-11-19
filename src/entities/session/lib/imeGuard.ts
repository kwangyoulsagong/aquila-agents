// Korean (and other) IME fixes in front of xterm's own key handling.
//
// While a Hangul syllable is being composed, Chromium can deliver Enter / Tab / Esc / Ctrl+<letter> as a keydown
// with keyCode 229 ("processed by the IME"). xterm's CompositionHelper drops every 229 keydown while composing,
// so that key is lost: the syllable gets committed but Enter never reaches the CLI, Ctrl+C doesn't interrupt.
// On macOS Chromium often sends the same key a second time (keyCode 13 / 67, isComposing=false) right after the
// commit; on other paths it doesn't. This guard handles both orderings:
//   - a 229 keydown for one of those keys → swallowed, and its bytes are written once the composition is committed
//     (after xterm sent the syllable, so order stays "글" then "\r");
//   - the same key arriving again as a normal keydown within DUPLICATE_MS → swallowed (and preventDefault-ed, so
//     no keypress/textarea insert follows) instead of being sent twice.
// Everything else (Hangul text, Backspace inside a syllable, Space, digits/punctuation) is left to xterm.

/** A real second press of the same key is never this fast; the IME's echo of it is. */
export const DUPLICATE_MS = 100;
/** If the commit we wait for never comes (IME cancelled), still send the key. */
export const COMMIT_TIMEOUT_MS = 150;

export type KeyLike = Pick<
  KeyboardEvent,
  'type' | 'code' | 'keyCode' | 'isComposing' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
> & { preventDefault?: () => void };

/** Bytes a key should send when the IME swallowed it, or null for keys left to xterm. */
export function bytesFor(e: KeyLike): string | null {
  if (e.metaKey || e.altKey) return null;
  if (e.ctrlKey) {
    const m = /^Key([A-Z])$/.exec(e.code);
    return m ? String.fromCharCode(m[1]!.charCodeAt(0) - 64) : null;
  }
  switch (e.code) {
    case 'Enter':
    case 'NumpadEnter':
      return '\r';
    case 'Tab':
      return e.shiftKey ? '\x1b[Z' : '\t';
    case 'Escape':
      return '\x1b';
    default:
      return null;
  }
}

export interface ImeGuardDeps {
  write: (data: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface ImeGuard {
  /** xterm's custom key event handler: false = xterm must not process this event. */
  onKey: (e: KeyLike) => boolean;
  /** Call from a `compositionend` listener added after xterm's (its commit is queued first). */
  onCompositionEnd: () => void;
  dispose: () => void;
}

export function createImeGuard({
  write,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
}: ImeGuardDeps): ImeGuard {
  /** Bytes waiting for the composition to commit. */
  let pending: string | null = null;
  let fallback: unknown = null;
  /** The last key we sent on the IME's behalf, to drop its echo. */
  let last: { code: string; ctrl: boolean; at: number } | null = null;

  const flush = () => {
    if (fallback !== null) clearTimer(fallback);
    fallback = null;
    if (pending === null) return;
    const data = pending;
    pending = null;
    write(data);
  };

  const onKey = (e: KeyLike): boolean => {
    const isDuplicate =
      last !== null &&
      e.keyCode !== 229 &&
      e.code === last.code &&
      e.ctrlKey === last.ctrl &&
      now() - last.at <= DUPLICATE_MS;
    if (isDuplicate) {
      // keydown and its keypress: neither may reach xterm (or the textarea).
      e.preventDefault?.();
      if (e.type === 'keyup') last = null;
      return false;
    }
    if (e.type !== 'keydown' || e.keyCode !== 229) return true;
    const data = bytesFor(e);
    if (data === null) return true;
    // Don't preventDefault: the IME still has to commit the syllable.
    last = { code: e.code, ctrl: e.ctrlKey, at: now() };
    pending = (pending ?? '') + data;
    if (fallback !== null) clearTimer(fallback);
    // Composing: wait for compositionend. Not composing (e.g. right after the 한/영 switch): next tick.
    fallback = setTimer(flush, e.isComposing ? COMMIT_TIMEOUT_MS : 0);
    return false;
  };

  return {
    onKey,
    // xterm sends the committed text in a 0 ms timer from its own compositionend listener; ours runs after it.
    onCompositionEnd: () => {
      if (pending !== null) setTimer(flush, 0);
    },
    dispose: () => {
      if (fallback !== null) clearTimer(fallback);
      pending = null;
    },
  };
}
