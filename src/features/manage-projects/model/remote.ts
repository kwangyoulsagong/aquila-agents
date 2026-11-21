import type { RemoteCheck, RemoteHost } from '@/shared/api';

/** Same rule as main (`electron/remote/ssh.ts` validAlias): an ssh config alias or user@host, nothing option-like. */
export function validHost(alias: string): boolean {
  const v = alias.trim();
  return /^[A-Za-z0-9_][A-Za-z0-9_.@%+-]*$/.test(v) && v.length <= 255;
}

/** Last path segment of a remote folder, for the default project name (`~` → the host). */
export function remoteName(path: string, alias: string): string {
  const last = path.trim().replace(/\/+$/, '').split('/').filter(Boolean).at(-1);
  return last && last !== '~' ? last : alias.trim();
}

/** Form values → the host sent to main (blank config dir left out). */
export function toHost(alias: string, claudeConfigDir: string): RemoteHost {
  const dir = claudeConfigDir.trim();
  return dir ? { alias: alias.trim(), claudeConfigDir: dir } : { alias: alias.trim() };
}

/** Why Add stops after the host check (T56): no connection, or no tmux (sessions wouldn't survive a drop). */
export function addBlocker(check: RemoteCheck): 'unreachable' | 'tmux' | null {
  if (!check.reachable) return 'unreachable';
  if (!check.tools.some((t) => t.tool === 'tmux' && t.path)) return 'tmux';
  return null;
}

/** Parent of an absolute host path (`/` stays `/`). */
export function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  return i <= 0 ? '/' : trimmed.slice(0, i);
}

/** A folder inside an absolute host path. */
export const childDir = (path: string, name: string): string => `${path.replace(/\/+$/, '')}/${name}`;
