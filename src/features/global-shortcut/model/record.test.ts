import { describe, expect, it } from 'vitest';
import { acceleratorLabel } from '@/shared/lib/shortcuts';
import { keyOf, recordKey } from './record';

const key = (
  code: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {},
) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('keyOf', () => {
  it('maps codes to accelerator keys', () => {
    expect(keyOf('KeyJ')).toBe('J');
    expect(keyOf('Digit5')).toBe('5');
    expect(keyOf('F12')).toBe('F12');
    expect(keyOf('Space')).toBe('Space');
    expect(keyOf('ArrowUp')).toBe('Up');
    expect(keyOf('Slash')).toBe('/');
    expect(keyOf('CapsLock')).toBeNull();
    expect(keyOf('F25')).toBeNull();
  });
});

describe('recordKey', () => {
  it('records a combo with a strong modifier', () => {
    expect(recordKey(key('KeyA', { metaKey: true, altKey: true }), 'mac')).toEqual({
      kind: 'ok',
      accelerator: 'Command+Alt+A',
    });
    expect(recordKey(key('Space', { ctrlKey: true, altKey: true }), 'windows')).toEqual({
      kind: 'ok',
      accelerator: 'Control+Alt+Space',
    });
  });

  it('shows modifiers while only they are down', () => {
    expect(recordKey(key('ShiftLeft', { shiftKey: true, metaKey: true }), 'mac')).toEqual({
      kind: 'partial',
      modifiers: ['Command', 'Shift'],
    });
  });

  it('refuses plain keys, Shift-only and unknown keys', () => {
    expect(recordKey(key('KeyJ'), 'mac').kind).toBe('needsModifier');
    expect(recordKey(key('KeyJ', { shiftKey: true }), 'mac').kind).toBe('needsModifier');
    expect(recordKey(key('KeyJ', { metaKey: true }), 'windows').kind).toBe('needsModifier');
    expect(recordKey(key('CapsLock', { metaKey: true }), 'mac').kind).toBe('unsupported');
  });

  it('refuses keys Aquila already uses in the window', () => {
    expect(recordKey(key('KeyJ', { metaKey: true }), 'mac').kind).toBe('inApp');
    expect(recordKey(key('KeyJ', { ctrlKey: true, shiftKey: true }), 'windows').kind).toBe('inApp');
  });
});

describe('acceleratorLabel', () => {
  it('labels recorded keys like the in-app shortcuts', () => {
    expect(acceleratorLabel('Command+Alt+A', 'mac')).toBe('⌥⌘A');
    expect(acceleratorLabel('Control+Shift+Space', 'mac')).toBe('⌃⇧Space');
    expect(acceleratorLabel('Control+Alt+Space', 'windows')).toBe('Ctrl+Alt+Space');
  });
});
