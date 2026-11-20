import { describe, expect, it } from 'vitest';
import { fullscreenAvailable } from './fullscreen';
import { accelerator, matchShortcut } from '@/shared/lib/shortcuts';

describe('full window', () => {
  it('is offered on macOS only', () => {
    expect(fullscreenAvailable('mac')).toBe(true);
    expect(fullscreenAvailable('windows')).toBe(false);
    expect(fullscreenAvailable('other')).toBe(false);
  });

  it('toggles with ⇧⌘F, and Esc is left to the terminal', () => {
    expect(accelerator('fullscreen', 'mac')).toBe('CommandOrControl+Shift+F');
    const key = { metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
    expect(matchShortcut({ ...key, code: 'KeyF' }, 'mac')).toBe('fullscreen');
    expect(
      matchShortcut(
        { code: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
        'mac',
      ),
    ).toBeNull();
  });
});
