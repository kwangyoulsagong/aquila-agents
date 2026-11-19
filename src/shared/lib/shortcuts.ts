// The one shortcut map. The key handler, the command palette, buttons/tooltips (and later menus and the guide)
// all read it, so a shortcut is defined once and its label can never drift from what the key handler does.
//
// Accelerators use Electron's syntax (`CommandOrControl+Shift+T`) so a native menu can take them as-is and
// Windows can reuse the map later (CommandOrControl → Ctrl there). Keys are matched by `KeyboardEvent.code`,
// not `key`, so shortcuts keep working with the Korean input source on (`key` would be "ㅅ" for T).

export type ShortcutId =
  | 'palette'
  | 'guide'
  | 'openClaude'
  | 'openCodex'
  | 'openShell'
  | 'closeSession'
  | 'toggleChanges'
  | 'nextWaiting'
  | 'splitRight'
  | 'splitDown'
  | 'focusLeft'
  | 'focusRight'
  | 'focusUp'
  | 'focusDown'
  | 'zoomPane'
  | 'resizeLeft'
  | 'resizeRight'
  | 'resizeUp'
  | 'resizeDown'
  | `project${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export type Platform = 'mac' | 'other';

export const SHORTCUTS: Readonly<Record<ShortcutId, string>> = {
  palette: 'CommandOrControl+K',
  guide: 'CommandOrControl+/',
  openClaude: 'CommandOrControl+T',
  openCodex: 'CommandOrControl+Shift+T',
  openShell: 'CommandOrControl+Alt+T',
  closeSession: 'CommandOrControl+W',
  toggleChanges: 'CommandOrControl+Shift+G',
  nextWaiting: 'CommandOrControl+J',
  splitRight: 'CommandOrControl+D',
  splitDown: 'CommandOrControl+Shift+D',
  focusLeft: 'CommandOrControl+Alt+Left',
  focusRight: 'CommandOrControl+Alt+Right',
  focusUp: 'CommandOrControl+Alt+Up',
  focusDown: 'CommandOrControl+Alt+Down',
  zoomPane: 'CommandOrControl+Shift+Enter',
  resizeLeft: 'CommandOrControl+Alt+Shift+Left',
  resizeRight: 'CommandOrControl+Alt+Shift+Right',
  resizeUp: 'CommandOrControl+Alt+Shift+Up',
  resizeDown: 'CommandOrControl+Alt+Shift+Down',
  project1: 'CommandOrControl+1',
  project2: 'CommandOrControl+2',
  project3: 'CommandOrControl+3',
  project4: 'CommandOrControl+4',
  project5: 'CommandOrControl+5',
  project6: 'CommandOrControl+6',
  project7: 'CommandOrControl+7',
  project8: 'CommandOrControl+8',
  project9: 'CommandOrControl+9',
};

export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

interface Combo {
  /** ⌘ on macOS, Ctrl elsewhere. */
  primary: boolean;
  /** Ctrl on macOS when it's asked for on its own (`Control+…`). */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Accelerator key name: `T`, `1`, `Left`, `/`. */
  key: string;
}

const NAMED_CODES: Record<string, string> = {
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  '/': 'Slash',
  '.': 'Period',
  ',': 'Comma',
  Enter: 'Enter',
  Space: 'Space',
  Tab: 'Tab',
  Esc: 'Escape',
};

function parse(accelerator: string): Combo {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  return {
    primary: mods.has('CommandOrControl') || mods.has('CmdOrCtrl'),
    ctrl: mods.has('Control') || mods.has('Ctrl'),
    shift: mods.has('Shift'),
    alt: mods.has('Alt') || mods.has('Option'),
    key,
  };
}

/** `KeyboardEvent.code` for an accelerator key name. */
function codeOf(key: string): string {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return NAMED_CODES[key] ?? key;
}

const COMBOS = new Map(SHORTCUT_IDS.map((id) => [id, parse(SHORTCUTS[id])]));

export function detectPlatform(): Platform {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? 'mac' : 'other';
}

const PLATFORM = detectPlatform();

/** Modifier keys of an event, in the terms of the map (exact match: ⌘⇧K isn't ⌘K). */
type KeyEventLike = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

/** The shortcut this key event triggers, if any. */
export function matchShortcut(e: KeyEventLike, platform: Platform = PLATFORM): ShortcutId | null {
  for (const [id, c] of COMBOS) {
    const meta = platform === 'mac' ? c.primary : false;
    const ctrl = platform === 'mac' ? c.ctrl : c.primary || c.ctrl;
    if (
      e.metaKey === meta &&
      e.ctrlKey === ctrl &&
      e.shiftKey === c.shift &&
      e.altKey === c.alt &&
      e.code === codeOf(c.key)
    )
      return id;
  }
  return null;
}

const MAC_KEYS: Record<string, string> = {
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Enter: '↩',
  Esc: '⎋',
  Tab: '⇥',
};

/** Label for a shortcut: `⌥⌘T` on macOS (Apple's modifier order ⌃⌥⇧⌘), `Ctrl+Alt+T` elsewhere. */
export function shortcutLabel(id: ShortcutId, platform: Platform = PLATFORM): string {
  const c = COMBOS.get(id) ?? parse(SHORTCUTS[id]);
  if (platform === 'mac') {
    return (
      (c.ctrl ? '⌃' : '') +
      (c.alt ? '⌥' : '') +
      (c.shift ? '⇧' : '') +
      (c.primary ? '⌘' : '') +
      (MAC_KEYS[c.key] ?? c.key)
    );
  }
  return [c.primary || c.ctrl ? 'Ctrl' : '', c.alt ? 'Alt' : '', c.shift ? 'Shift' : '', c.key]
    .filter(Boolean)
    .join('+');
}

/** `Open Claude (⌘T)` — a tooltip with its shortcut. */
export function withShortcut(label: string, id: ShortcutId, platform: Platform = PLATFORM): string {
  return `${label} (${shortcutLabel(id, platform)})`;
}

/** Index (0–8) of a `projectN` shortcut, or null for any other shortcut. */
export function projectIndex(id: ShortcutId): number | null {
  const m = /^project([1-9])$/.exec(id);
  return m ? Number(m[1]) - 1 : null;
}
