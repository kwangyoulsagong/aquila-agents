import { describe, expect, it } from 'vitest';
import type { KeyLike } from './imeGuard';
import { windowsCopyKey } from './windowsKeys';

const key = (mods: Partial<KeyLike> = {}): KeyLike => ({
  type: 'keydown',
  code: 'KeyC',
  keyCode: 67,
  isComposing: false,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const selection = (text: string) => {
  let current = text;
  return {
    hasSelection: () => current !== '',
    getSelection: () => current,
    clearSelection: () => (current = ''),
  };
};

describe('windowsCopyKey', () => {
  it('copies and clears a selection instead of sending ^C', () => {
    const copied: string[] = [];
    const sel = selection('npm run dev');
    expect(windowsCopyKey(key(), sel, (t) => copied.push(t))).toBe(false);
    expect(copied).toEqual(['npm run dev']);
    // The next Ctrl+C has no selection: it interrupts again.
    expect(windowsCopyKey(key(), sel, (t) => copied.push(t))).toBe(true);
    expect(copied).toHaveLength(1);
  });

  it('leaves every other key to xterm', () => {
    const sel = selection('x');
    const never = () => {
      throw new Error('copied');
    };
    expect(windowsCopyKey(key({ shiftKey: true }), sel, never)).toBe(true);
    expect(windowsCopyKey(key({ code: 'KeyV' }), sel, never)).toBe(true);
    expect(windowsCopyKey(key({ type: 'keyup' }), sel, never)).toBe(true);
    expect(windowsCopyKey(key({ ctrlKey: false }), sel, never)).toBe(true);
  });
});
