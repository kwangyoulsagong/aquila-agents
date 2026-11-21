import { describe, expect, it } from 'vitest';
import { isDestructive } from './risk';

describe('isDestructive', () => {
  it.each([
    'Bash: rm -rf dist',
    'Bash: rm -fr node_modules',
    'Bash: rm -r build',
    'Bash: sudo rm --recursive /tmp/x',
    'Bash: git push --force origin main',
    'Bash: git push -f',
    'Bash: git push --force-with-lease',
    'Bash: git reset --hard HEAD~3',
    'Bash: git clean -fdx',
    'Bash: git branch -D feature',
    'Bash: git checkout -- .',
    'Bash: psql -c "DROP TABLE users"',
    'Bash: psql -c "truncate table logs"',
    'Bash: sqlite3 app.db "DELETE FROM users"',
    'Bash: npx prisma migrate reset',
    'Bash: rails db:reset',
    'Bash: terraform destroy',
    'Bash: kubectl delete pod api-1',
    'Bash: npm install --force',
    'Allow Bash: rm -rf /?',
  ])('flags %s', (text) => expect(isDestructive(text)).toBe(true));

  it.each([
    'Bash: npm install',
    'Bash: rm notes.txt',
    'Bash: git push origin main',
    'Bash: git reset HEAD file.ts',
    'Bash: git branch -d merged',
    'Bash: git checkout -- src/a.ts',
    'Bash: psql -c "DELETE FROM users WHERE id = 1"',
    'Bash: ls -rf',
    'Edit: src/format.ts',
    'Do you want to proceed?',
    'Bash: npm run format',
    '',
    undefined,
  ])('leaves %s', (text) => expect(isDestructive(text)).toBe(false));
});
