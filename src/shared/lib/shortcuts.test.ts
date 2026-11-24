import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_IDS,
  WINDOWS_SHORTCUTS,
  accelerator,
  matchShortcut,
  projectIndex,
  shortcutLabel,
  withShortcut,
  yieldsToText,
} from './shortcuts';

const key = (
  code: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('matchShortcut', () => {
  it('maps ⌘ combos on macOS by key code', () => {
    expect(matchShortcut(key('KeyT', { meta: true }), 'mac')).toBe('openClaude');
    expect(matchShortcut(key('KeyT', { meta: true, shift: true }), 'mac')).toBe('openCodex');
    expect(matchShortcut(key('KeyT', { meta: true, alt: true }), 'mac')).toBe('openShell');
    expect(matchShortcut(key('ArrowLeft', { meta: true, alt: true }), 'mac')).toBe('focusLeft');
    expect(matchShortcut(key('Digit3', { meta: true }), 'mac')).toBe('project3');
  });

  it('needs the exact modifiers', () => {
    expect(matchShortcut(key('KeyK', { meta: true, shift: true }), 'mac')).toBeNull();
    expect(matchShortcut(key('KeyT', { meta: true, shift: true, alt: true }), 'mac')).toBeNull();
    expect(matchShortcut(key('KeyT'), 'mac')).toBeNull();
    expect(matchShortcut(key('KeyT', { ctrl: true }), 'mac')).toBeNull();
    expect(matchShortcut(key('Digit0', { meta: true }), 'mac')).toBeNull();
  });

  it('uses Ctrl for CommandOrControl elsewhere', () => {
    expect(matchShortcut(key('KeyT', { ctrl: true }), 'other')).toBe('openClaude');
    expect(matchShortcut(key('KeyT', { meta: true }), 'other')).toBeNull();
  });

  it('gives every shortcut a unique combo', () => {
    expect(new Set(Object.values(SHORTCUTS)).size).toBe(SHORTCUT_IDS.length);
    expect(new Set(Object.values(WINDOWS_SHORTCUTS)).size).toBe(SHORTCUT_IDS.length);
  });
});

describe('Windows map', () => {
  it('never takes a plain Ctrl+letter (the terminal’s) or Ctrl+Alt (AltGr)', () => {
    for (const acc of Object.values(WINDOWS_SHORTCUTS)) {
      const parts = acc.split('+');
      const key = parts.pop()!;
      const ctrl = parts.some((p) => p === 'Control' || p === 'CommandOrControl');
      expect(ctrl && parts.includes('Alt'), acc).toBe(false);
      if (ctrl && /^[A-Z]$/.test(key)) expect(parts.includes('Shift'), acc).toBe(true);
    }
  });

  it('matches Ctrl+Shift, Alt and F1 combos', () => {
    expect(matchShortcut(key('KeyT', { ctrl: true, shift: true }), 'windows')).toBe('openClaude');
    expect(matchShortcut(key('KeyT', { ctrl: true }), 'windows')).toBeNull();
    expect(matchShortcut(key('KeyK', { ctrl: true, shift: true }), 'windows')).toBe('palette');
    expect(matchShortcut(key('ArrowLeft', { alt: true }), 'windows')).toBe('focusLeft');
    expect(matchShortcut(key('Equal', { alt: true, shift: true }), 'windows')).toBe('splitRight');
    expect(matchShortcut(key('F1'), 'windows')).toBe('guide');
    expect(matchShortcut(key('KeyF', { ctrl: true, shift: true }), 'windows')).toBe('find');
    expect(matchShortcut(key('KeyF', { ctrl: true }), 'windows')).toBeNull();
    expect(matchShortcut(key('Digit2', { ctrl: true }), 'windows')).toBe('project2');
  });

  it('labels and menu accelerators follow the platform', () => {
    expect(shortcutLabel('closeSession', 'windows')).toBe('Ctrl+Shift+W');
    expect(shortcutLabel('focusUp', 'windows')).toBe('Alt+Up');
    expect(accelerator('openClaude', 'windows')).toBe('Control+Shift+T');
    expect(accelerator('openClaude', 'mac')).toBe('CommandOrControl+T');
  });
});

describe('shortcutLabel', () => {
  it('shows ⌘ and Apple modifier order on macOS', () => {
    expect(shortcutLabel('openClaude', 'mac')).toBe('⌘T');
    expect(shortcutLabel('openCodex', 'mac')).toBe('⇧⌘T');
    expect(shortcutLabel('openShell', 'mac')).toBe('⌥⌘T');
    expect(shortcutLabel('focusLeft', 'mac')).toBe('⌥⌘←');
  });

  it('spells modifiers out elsewhere', () => {
    expect(shortcutLabel('openCodex', 'other')).toBe('Ctrl+Shift+T');
    expect(shortcutLabel('focusUp', 'other')).toBe('Ctrl+Alt+Up');
  });

  it('builds tooltips', () => {
    expect(withShortcut('Open Claude', 'openClaude', 'mac')).toBe('Open Claude (⌘T)');
  });
});

describe('projectIndex', () => {
  it('reads the digit of project shortcuts only', () => {
    expect(projectIndex('project1')).toBe(0);
    expect(projectIndex('project9')).toBe(8);
    expect(projectIndex('palette')).toBeNull();
  });
});

describe('yieldsToText', () => {
  it('never closes a session from the note editor or an input', () => {
    expect(yieldsToText('closeSession', 'noteEditor')).toBe(true);
    expect(yieldsToText('closeSession', 'textField')).toBe(true);
    expect(yieldsToText('closeSession', 'terminal')).toBe(false);
  });
  it("leaves the note editor its own find and select-next (⌘D), but not app-wide keys", () => {
    expect(yieldsToText('find', 'noteEditor')).toBe(true);
    expect(yieldsToText('splitRight', 'noteEditor')).toBe(true);
    expect(yieldsToText('palette', 'noteEditor')).toBe(false);
    expect(yieldsToText('splitRight', 'terminal')).toBe(false);
    expect(yieldsToText('find', 'textField')).toBe(false);
  });
});
