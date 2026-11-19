/** Characters a shell (and Claude's path detection) would split or expand: escaped with a backslash, like Terminal.app. */
const SPECIAL = /[\s\\'"`$&|;<>()[\]{}*?!#~^]/g;

/** One path, shell-escaped: `/a/my file.png` → `/a/my\ file.png`. */
export function shellQuote(path: string): string {
  return path.replace(SPECIAL, (c) => `\\${c}`);
}

/** What a paste or drop types into the session: escaped paths separated by spaces, plus a trailing space. */
export function pathsInput(paths: readonly string[]): string {
  const kept = paths.filter(Boolean);
  return kept.length ? `${kept.map(shellQuote).join(' ')} ` : '';
}
