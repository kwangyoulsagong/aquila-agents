import { detectPlatform, type Platform } from '@/shared/lib/shortcuts';

/**
 * Full window is macOS only: on Windows, re-laying out the terminal under an open Hangul composition drops or
 * repeats the pasted text (T18/T19), so the toggle isn't offered there at all.
 */
export const fullscreenAvailable = (platform: Platform = detectPlatform()) => platform === 'mac';
