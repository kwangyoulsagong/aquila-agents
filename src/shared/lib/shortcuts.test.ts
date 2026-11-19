import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_IDS,
  matchShortcut,
  projectIndex,
  shortcutLabel,
  withShortcut,
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
