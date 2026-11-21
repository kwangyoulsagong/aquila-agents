import { describe, expect, it } from 'vitest';
import { fileRisk, sortByRisk } from './risk';

describe('fileRisk', () => {
  it.each([
    ['prisma/schema.prisma', 'migration'],
    ['db/migrations/0001_init.ts', 'migration'],
    ['supabase/seed.sql', 'migration'],
    ['package-lock.json', 'lockfile'],
    ['apps/web/pnpm-lock.yaml', 'lockfile'],
    ['go.sum', 'lockfile'],
    ['.env', 'env'],
    ['apps/api/.env.local', 'env'],
    ['config/prod.env', 'env'],
    ['AGENTS.md', 'prompt'],
    ['packages/x/CLAUDE.md', 'prompt'],
    ['src/prompts/summary.txt', 'prompt'],
    ['src/agent/system.prompt.md', 'prompt'],
    ['.claude/agents/reviewer.md', 'prompt'],
    ['.github/workflows/ci.yml', 'ci'],
  ])('%s → %s', (path, kind) => {
    expect(fileRisk(path)).toBe(kind);
  });

  it.each(['src/app.ts', 'README.md', 'docs/env.md', 'src/environment.ts', 'src/promptly.ts', '.github/CODEOWNERS'])(
    '%s is ordinary',
    (path) => {
      expect(fileRisk(path)).toBeUndefined();
    },
  );
});

describe('sortByRisk', () => {
  it('puts risky files first and keeps order inside each group', () => {
    const paths = ['src/a.ts', 'package-lock.json', 'src/b.ts', 'prisma/schema.prisma', 'src/c.ts'];
    expect(sortByRisk(paths, (p) => p)).toEqual([
      'package-lock.json',
      'prisma/schema.prisma',
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
  });
});
