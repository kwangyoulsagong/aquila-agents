import { describe, expect, it, vi } from 'vitest';
import { currentTheme, followSystemTheme, onThemeChange } from './theme';

function fakeQuery(matches: boolean) {
  let handler: (() => void) | null = null;
  const q = {
    matches,
    addEventListener: (_: string, fn: () => void) => (handler = fn),
    flip(next: boolean) {
      q.matches = next;
      handler?.();
    },
  };
  return q;
}

describe('followSystemTheme', () => {
  it('sets data-theme from the OS appearance and follows changes', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    const q = fakeQuery(false);
    followSystemTheme(root, q as unknown as MediaQueryList);
    expect(root.dataset.theme).toBe('dark');
    expect(currentTheme()).toBe('dark');

    const seen = vi.fn();
    const off = onThemeChange(seen);
    q.flip(true);
    expect(root.dataset.theme).toBe('light');
    expect(seen).toHaveBeenCalledWith('light');

    off();
    q.flip(false);
    expect(root.dataset.theme).toBe('dark');
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
