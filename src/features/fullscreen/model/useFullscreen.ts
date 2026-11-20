import { useCallback, useState } from 'react';
import { fullscreenAvailable } from './fullscreen';

export interface FullscreenApi {
  /** False where the toggle isn't offered (not macOS): `on` stays false and `toggle` does nothing. */
  available: boolean;
  /** Sidebar, tab bar and side panels hidden; only the focused pane is on screen. */
  on: boolean;
  toggle: () => void;
}

/**
 * Full window (T37). Display state only, never saved: a relaunch starts with the normal workspace. Only its own
 * shortcut leaves — Esc belongs to the CLI in the terminal.
 */
export function useFullscreen(available = fullscreenAvailable()): FullscreenApi {
  const [on, setOn] = useState(false);
  const toggle = useCallback(() => {
    if (available) setOn((o) => !o);
  }, [available]);
  return { available, on: available && on, toggle };
}
