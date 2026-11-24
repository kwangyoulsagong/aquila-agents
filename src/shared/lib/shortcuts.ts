// The one shortcut map. The key handler, the command palette, buttons/tooltips (and later menus and the guide)
// all read it, so a shortcut is defined once and its label can never drift from what the key handler does.
//
// Accelerators use Electron's syntax (`CommandOrControl+Shift+T`) so a native menu can take them as-is.
// Windows (T19) has its own map: Ctrl+<letter> belongs to the terminal there (Ctrl+T/W/D/J/Y are control
// characters the CLIs use), and Ctrl+Alt is AltGr on many keyboards, so it uses Ctrl+Shift and Alt instead. Keys are matched by `KeyboardEvent.code`,
// not `key`, so shortcuts keep working with the Korean input source on (`key` would be "ㅅ" for T).

export type ShortcutId =
  | 'palette'
  | 'guide'
  | 'openClaude'
  | 'openCodex'
  | 'openShell'
  | 'closeSession'
  | 'toggleChanges'
  | 'togglePreview'
  | 'toggleRun'
  | 'toggleGraph'
  | 'quickOpen'
  | 'history'
  | 'nextWaiting'
  | 'copyLastReply'
  | 'quickSelect'
  | 'find'
  | 'splitRight'
  | 'splitDown'
  | 'focusLeft'
  | 'focusRight'
  | 'focusUp'
  | 'focusDown'
  | 'zoomPane'
  | 'fullscreen'
  | 'resizeLeft'
  | 'resizeRight'
  | 'resizeUp'
  | 'resizeDown'
  | `project${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export type Platform = 'mac' | 'windows' | 'other';

export const SHORTCUTS: Readonly<Record<ShortcutId, string>> = {
  palette: 'CommandOrControl+K',
  guide: 'CommandOrControl+/',
  openClaude: 'CommandOrControl+T',
  openCodex: 'CommandOrControl+Shift+T',
  openShell: 'CommandOrControl+Alt+T',
  closeSession: 'CommandOrControl+W',
  toggleChanges: 'CommandOrControl+Shift+G',
  togglePreview: 'CommandOrControl+Shift+P',
  toggleRun: 'CommandOrControl+Shift+R',
  // Not ⌘⇧E (T66's spec): quick select (T28) has had that key since before the graph.
  toggleGraph: 'CommandOrControl+Shift+N',
  quickOpen: 'CommandOrControl+O',
  history: 'CommandOrControl+Y',
  nextWaiting: 'CommandOrControl+J',
  copyLastReply: 'CommandOrControl+Shift+C',
  quickSelect: 'CommandOrControl+Shift+E',
  find: 'CommandOrControl+F',
  splitRight: 'CommandOrControl+D',
  splitDown: 'CommandOrControl+Shift+D',
  focusLeft: 'CommandOrControl+Alt+Left',
  focusRight: 'CommandOrControl+Alt+Right',
  focusUp: 'CommandOrControl+Alt+Up',
  focusDown: 'CommandOrControl+Alt+Down',
  zoomPane: 'CommandOrControl+Shift+Enter',
  // Not ⌃⌘F: the default app menu's "Toggle Full Screen" takes that key before the page sees it. macOS only (T37).
  fullscreen: 'CommandOrControl+Shift+F',
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

/** Windows: no plain Ctrl+<letter> (the terminal's), no Ctrl+Alt (AltGr); focus/resize like Windows Terminal. */
export const WINDOWS_SHORTCUTS: Readonly<Record<ShortcutId, string>> = {
  ...SHORTCUTS,
  palette: 'Control+Shift+K',
  guide: 'F1',
  openClaude: 'Control+Shift+T',
  openCodex: 'Control+Shift+X',
  openShell: 'Control+Shift+S',
  closeSession: 'Control+Shift+W',
  history: 'Control+Shift+H',
  // Ctrl+O is the shell's (operate-and-get-next).
  quickOpen: 'Control+Shift+O',
  nextWaiting: 'Control+Shift+J',
  // Ctrl+F is the terminal's (forward a char). Full window is macOS-only (T37), so F11 just keeps Ctrl+Shift+F free.
  find: 'Control+Shift+F',
  fullscreen: 'F11',
  splitRight: 'Alt+Shift+=',
  splitDown: 'Alt+Shift+-',
  focusLeft: 'Alt+Left',
  focusRight: 'Alt+Right',
  focusUp: 'Alt+Up',
  focusDown: 'Alt+Down',
  resizeLeft: 'Alt+Shift+Left',
  resizeRight: 'Alt+Shift+Right',
  resizeUp: 'Alt+Shift+Up',
  resizeDown: 'Alt+Shift+Down',
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
  '=': 'Equal',
  '-': 'Minus',
};

function parse(accelerator: string): Combo {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  return {
    // `Command` only comes from a recorded global shortcut (T41, macOS); on macOS it is the same key as primary.
    primary: mods.has('CommandOrControl') || mods.has('CmdOrCtrl') || mods.has('Command') || mods.has('Cmd'),
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

/** The accelerator map a platform uses. */
export const shortcutsFor = (platform: Platform) => (platform === 'windows' ? WINDOWS_SHORTCUTS : SHORTCUTS);

const combosOf = (map: Readonly<Record<ShortcutId, string>>) =>
  new Map(SHORTCUT_IDS.map((id) => [id, parse(map[id])]));
const COMBOS = { default: combosOf(SHORTCUTS), windows: combosOf(WINDOWS_SHORTCUTS) };
const combos = (platform: Platform) => (platform === 'windows' ? COMBOS.windows : COMBOS.default);

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  if (/Mac/i.test(navigator.userAgent)) return 'mac';
  return /Windows/i.test(navigator.userAgent) ? 'windows' : 'other';
}

const PLATFORM = detectPlatform();

/** Electron accelerator for a shortcut on this platform (native menus show it next to the item). */
export const accelerator = (id: ShortcutId, platform: Platform = PLATFORM) => shortcutsFor(platform)[id];

/** Modifier keys of an event, in the terms of the map (exact match: ⌘⇧K isn't ⌘K). */
// Structural, not `Pick<KeyboardEvent>`: the main process (app menu, T47) compiles this file without the DOM lib.
interface KeyEventLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The shortcut this key event triggers, if any. */
export function matchShortcut(e: KeyEventLike, platform: Platform = PLATFORM): ShortcutId | null {
  for (const [id, c] of combos(platform)) {
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

/** Where a key event was typed, for shortcuts that mean something else while editing text. */
export type KeyTarget = 'terminal' | 'noteEditor' | 'textField' | 'other';

/**
 * True when the shortcut should be left to the text being edited: ⌘W must never kill a session from the note
 * editor or an input, and the note editor keeps its own ⌘F (find) and ⌘D (select next match).
 */
export function yieldsToText(id: ShortcutId, target: KeyTarget): boolean {
  if (target === 'noteEditor') return id === 'closeSession' || id === 'find' || id === 'splitRight' || id === 'splitDown';
  if (target === 'textField') return id === 'closeSession';
  return false;
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
  return comboLabel(combos(platform).get(id) ?? parse(shortcutsFor(platform)[id]), platform);
}

/** Label for any accelerator string (a recorded global shortcut, T41), same format as `shortcutLabel`. */
export const acceleratorLabel = (accelerator: string, platform: Platform = PLATFORM): string =>
  comboLabel(parse(accelerator), platform);

function comboLabel(c: Combo, platform: Platform): string {
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
