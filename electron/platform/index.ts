// The platform layer for this OS. Linux uses the macOS (POSIX login shell) layer.
import { darwin } from './darwin';
import { win32 } from './win32';
import type { PlatformLayer } from './types';

export type { GitInvocation, PlatformLayer, SessionCommand, ShellProfile, SpawnSpec } from './types';
export { KillQueue } from './killQueue';
export { platformInfo, windowsBuild } from './os';

export const isWindows = process.platform === 'win32';

export const platform: PlatformLayer = isWindows ? win32 : darwin;

/** Gap between pty kills: ConPTY wants them one at a time. */
export const KILL_GAP_MS = isWindows ? 50 : 0;
