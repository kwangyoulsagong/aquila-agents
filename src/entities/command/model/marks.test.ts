import { describe, expect, it } from 'vitest';
import { commandMarks } from './marks';

describe('commandMarks', () => {
  it.each([
    ['npm test', ['test']],
    ['pnpm run test:unit', ['test']],
    ['npx vitest run src', ['test']],
    ['go test ./...', ['test']],
    ['rm -rf dist', ['destructive']],
    ['npx prisma migrate dev --name init', ['migration']],
    ['npx prisma migrate reset --force', ['destructive', 'migration']],
    ['alembic upgrade head', ['migration']],
    ['ls -la', []],
    ['npm run build', []],
    ['cat latest.txt', []],
  ])('%s → %j', (command, marks) => {
    expect(commandMarks(command)).toEqual(marks);
  });
});
