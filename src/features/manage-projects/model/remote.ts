import type { RemoteHost } from '@/shared/api';

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
