// OS facts the renderer needs at startup (read synchronously in preload; no Node deps beyond `os`).
import os from 'node:os';
import type { PlatformInfo } from '../../src/shared/api/types';

/** Windows build number (`10.0.22631` → 22631) for xterm's ConPTY handling; undefined elsewhere. */
export function windowsBuild(release = os.release(), plat: string = process.platform): number | undefined {
  if (plat !== 'win32') return undefined;
  const build = Number(release.split('.')[2]);
  return Number.isFinite(build) && build > 0 ? build : undefined;
}

export function platformInfo(): PlatformInfo {
  const os = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const build = windowsBuild();
  return { os, ...(build ? { windowsBuild: build } : {}) };
}
