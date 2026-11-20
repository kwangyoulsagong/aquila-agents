// Turns a key press in the settings dialog into an Electron accelerator for the global shortcut (T41).
// Matched by `KeyboardEvent.code`, like the in-app map, so it works with the Korean input source on.
import { matchShortcut, type Platform } from '@/shared/lib/shortcuts';

export type Recorded =
  /** Only modifiers are down so far: keep showing them, wait for a key. */
  | { kind: 'partial'; modifiers: string[] }
  | { kind: 'ok'; accelerator: string }
  /** Needs ⌘ / Ctrl / ⌥ (Shift alone would take a capital letter from every app), or the key isn't supported. */
  | { kind: 'needsModifier' }
  | { kind: 'unsupported' }
  /** Aquila already uses it in the window; a global key would take it from there. */
  | { kind: 'inApp' };

type KeyEventLike = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

const PUNCTUATION: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

const MODIFIER_CODES = /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/;

/** Accelerator key name for a `KeyboardEvent.code`; null for keys we don't take. */
export function keyOf(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return PUNCTUATION[code] ?? null;
}

/** Modifiers held, in Electron's names. The Windows key isn't offered (the OS keeps most of its combos). */
function modifiersOf(e: KeyEventLike, platform: Platform): string[] {
  return [
    ...(platform === 'mac' && e.metaKey ? ['Command'] : []),
    ...(e.ctrlKey ? ['Control'] : []),
    ...(e.altKey ? ['Alt'] : []),
    ...(e.shiftKey ? ['Shift'] : []),
  ];
}

export function recordKey(e: KeyEventLike, platform: Platform): Recorded {
  const modifiers = modifiersOf(e, platform);
  if (MODIFIER_CODES.test(e.code)) return { kind: 'partial', modifiers };
  const key = keyOf(e.code);
  if (!key) return { kind: 'unsupported' };
  if (!modifiers.some((m) => m !== 'Shift')) return { kind: 'needsModifier' };
  if (matchShortcut(e, platform)) return { kind: 'inApp' };
  return { kind: 'ok', accelerator: [...modifiers, key].join('+') };
}
