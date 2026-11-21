// Which changed files deserve a second look (T57): migrations, lockfiles, env files, prompt files, CI.
// Pure path rules — a hint for the eye, no git calls, same for local and remote projects.

export type FileRisk = 'migration' | 'lockfile' | 'env' | 'prompt' | 'ci';

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'composer.lock',
  'go.sum',
  'Podfile.lock',
  'pubspec.lock',
  'mix.lock',
  'flake.lock',
]);

const PROMPT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'GEMINI.md', '.cursorrules']);

/** The risk kind of a repo-relative path, or undefined for an ordinary file. First match wins. */
export function fileRisk(path: string): FileRisk | undefined {
  const p = path.replace(/\\/g, '/');
  const parts = p.split('/');
  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);

  if (
    dirs.some((d) => d === 'migrations' || d === 'migration' || d === 'migrate') ||
    name.endsWith('.sql') ||
    name === 'schema.prisma'
  )
    return 'migration';
  if (LOCKFILES.has(name)) return 'lockfile';
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) return 'env';
  if (
    PROMPT_FILES.has(name) ||
    /\.prompt(\.|$)/.test(name) ||
    dirs.includes('prompts') ||
    (dirs.includes('.claude') && (dirs.includes('agents') || dirs.includes('commands') || dirs.includes('skills')))
  )
    return 'prompt';
  if (p.startsWith('.github/workflows/') || name === '.gitlab-ci.yml' || p.startsWith('.circleci/'))
    return 'ci';
  return undefined;
}

/** Risky files first; order inside each group is kept (stable sort). */
export function sortByRisk<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, risky: fileRisk(pathOf(item)) ? 0 : 1 }))
    .sort((a, b) => a.risky - b.risky || a.i - b.i)
    .map((x) => x.item);
}
