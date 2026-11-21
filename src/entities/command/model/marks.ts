import { isDestructive } from '@/shared/lib/risk';

/** What a command is worth a glance for (T59): destructive (T52's patterns), a test run, a migration. */
export type CommandMark = 'destructive' | 'test' | 'migration';

const TEST =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::\S+)?|vitest|jest|pytest|mocha|rspec|phpunit|go\s+test|cargo\s+test|playwright\s+test|dotnet\s+test|mvn\s+test|gradlew?\s+test|tox)\b/;
const MIGRATION =
  /\b(?:prisma\s+(?:migrate|db\s+push)|migrate|migration|alembic|knex\s+migrate|sequelize\s+db:migrate|rails\s+db:|rake\s+db:|flyway|liquibase|drizzle-kit\s+(?:push|migrate)|supabase\s+db)\b/;

export function commandMarks(command: string): CommandMark[] {
  const marks: CommandMark[] = [];
  if (isDestructive(command)) marks.push('destructive');
  if (TEST.test(command)) marks.push('test');
  if (MIGRATION.test(command)) marks.push('migration');
  return marks;
}
