import { describe, expect, it } from 'vitest';
import { openActions } from './actions';

describe('openActions', () => {
  it("puts the project's default agent first as the primary button", () => {
    expect(openActions().map((a) => [a.kind, a.primary])).toEqual([
      ['claude', true],
      ['codex', false],
    ]);
    expect(openActions('codex').map((a) => [a.kind, a.primary])).toEqual([
      ['codex', true],
      ['claude', false],
    ]);
    expect(openActions('shell').map((a) => a.kind)).toEqual(['shell', 'claude', 'codex']);
  });
});
