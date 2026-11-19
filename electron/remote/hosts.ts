// Host aliases from the user's ~/.ssh/config (read-only), for the remote project form's suggestions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** `Host` names without wildcards / negations, in file order, deduplicated. Follows simple `Include`s (no globs). */
export function parseHosts(text: string, readInclude?: (file: string) => string | null, depth = 0): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^(\w+)\s*=?\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'host') {
      for (const name of m[2].split(/\s+/)) if (name && !/[*?!]/.test(name)) out.push(name);
    } else if (key === 'include' && readInclude && depth < 4) {
      for (const file of m[2].split(/\s+/)) {
        if (!file || /[*?]/.test(file)) continue;
        const inc = readInclude(file);
        if (inc) out.push(...parseHosts(inc, readInclude, depth + 1));
      }
    }
  }
  return [...new Set(out)];
}

export function sshHosts(home = os.homedir()): string[] {
  const dir = path.join(home, '.ssh');
  const read = (file: string): string | null => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  const text = read(path.join(dir, 'config'));
  if (!text) return [];
  // Relative includes are relative to ~/.ssh.
  const resolve = (f: string) =>
    f.startsWith('~/') ? path.join(home, f.slice(2)) : path.isAbsolute(f) ? f : path.join(dir, f);
  return parseHosts(text, (f) => read(resolve(f)));
}
