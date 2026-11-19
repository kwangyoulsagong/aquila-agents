import { describe, expect, it } from 'vitest';
import { bytesFor, createImeGuard, DUPLICATE_MS, type KeyLike } from './imeGuard';

const key = (over: Partial<KeyLike>): KeyLike => ({
  type: 'keydown',
  code: 'Enter',
  keyCode: 13,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

function setup() {
  const written: string[] = [];
  let t = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const guard = createImeGuard({
    write: (d) => written.push(d),
    now: () => t,
    setTimer: (fn, ms) => {
      const timer = { fn, at: t + ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (x) => {
      const i = timers.indexOf(x as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    t += ms;
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (timer.at <= t && timers.includes(timer)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    }
  };
  return { guard, written, advance };
}

describe('bytesFor', () => {
  it('maps Enter, Tab, Shift+Tab, Esc and Ctrl+letters by code', () => {
    expect(bytesFor(key({ code: 'Enter' }))).toBe('\r');
    expect(bytesFor(key({ code: 'NumpadEnter' }))).toBe('\r');
    expect(bytesFor(key({ code: 'Tab' }))).toBe('\t');
    expect(bytesFor(key({ code: 'Tab', shiftKey: true }))).toBe('\x1b[Z');
    expect(bytesFor(key({ code: 'Escape' }))).toBe('\x1b');
    expect(bytesFor(key({ code: 'KeyC', ctrlKey: true }))).toBe('\x03');
    expect(bytesFor(key({ code: 'KeyD', ctrlKey: true, shiftKey: true }))).toBe('\x04');
  });
  it('leaves text, Backspace, Space, ⌘ and ⌥ combos to xterm', () => {
    expect(bytesFor(key({ code: 'KeyG' }))).toBeNull();
    expect(bytesFor(key({ code: 'Backspace' }))).toBeNull();
    expect(bytesFor(key({ code: 'Space' }))).toBeNull();
    expect(bytesFor(key({ code: 'KeyT', metaKey: true }))).toBeNull();
    expect(bytesFor(key({ code: 'Enter', altKey: true }))).toBeNull();
    expect(bytesFor(key({ code: 'Digit1', ctrlKey: true }))).toBeNull();
  });
});

describe('createImeGuard', () => {
  it('lets normal keys through', () => {
    const { guard, written } = setup();
    expect(guard.onKey(key({}))).toBe(true);
    expect(guard.onKey(key({ code: 'KeyC', keyCode: 67, ctrlKey: true }))).toBe(true);
    expect(written).toEqual([]);
  });

  it('Enter as 229 while composing: sent once after the commit, the echo is dropped', () => {
    const { guard, written, advance } = setup();
    expect(guard.onKey(key({ keyCode: 229, isComposing: true }))).toBe(false);
    expect(written).toEqual([]); // waits for the syllable
    guard.onCompositionEnd();
    let prevented = false;
    expect(guard.onKey(key({ preventDefault: () => (prevented = true) }))).toBe(false);
    expect(prevented).toBe(true);
    expect(guard.onKey(key({ type: 'keypress' }))).toBe(false);
    advance(0);
    expect(written).toEqual(['\r']);
    expect(guard.onKey(key({ type: 'keyup' }))).toBe(false);
    // A later, real Enter goes to xterm again.
    advance(DUPLICATE_MS + 1);
    expect(guard.onKey(key({}))).toBe(true);
  });

  it('Enter as 229 with no echo and no compositionend: sent after the timeout', () => {
    const { guard, written, advance } = setup();
    guard.onKey(key({ keyCode: 229, isComposing: true }));
    advance(149);
    expect(written).toEqual([]);
    advance(1);
    expect(written).toEqual(['\r']);
  });

  it('Ctrl+C as 229 right after the 한/영 switch (not composing): sent on the next tick', () => {
    const { guard, written, advance } = setup();
    expect(guard.onKey(key({ code: 'KeyC', keyCode: 229, ctrlKey: true }))).toBe(false);
    advance(0);
    expect(written).toEqual(['\x03']);
    // Its echo with keyCode 67 is not a second Ctrl+C.
    expect(guard.onKey(key({ code: 'KeyC', keyCode: 67, ctrlKey: true }))).toBe(false);
    expect(written).toEqual(['\x03']);
  });

  it('a 229 for a text key stays with xterm (composition)', () => {
    const { guard } = setup();
    expect(guard.onKey(key({ code: 'KeyG', keyCode: 229, isComposing: true }))).toBe(true);
    expect(guard.onKey(key({ code: 'Space', keyCode: 229, isComposing: true }))).toBe(true);
    expect(guard.onKey(key({ code: 'Backspace', keyCode: 229, isComposing: true }))).toBe(true);
  });
});
