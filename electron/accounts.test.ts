import { describe, expect, it } from 'vitest';
import { definedInRc, functionName, isLoggedIn, shellSnippet } from './accounts';

describe('isLoggedIn', () => {
  it('is true only when oauthAccount is present', () => {
    expect(isLoggedIn(JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }))).toBe(true);
    expect(isLoggedIn(JSON.stringify({ numStartups: 3 }))).toBe(false);
    expect(isLoggedIn(JSON.stringify({ oauthAccount: null }))).toBe(false);
  });

  it('treats a missing or broken file as logged out', () => {
    expect(isLoggedIn(null)).toBe(false);
    expect(isLoggedIn('{ not json')).toBe(false);
  });
});

describe('shellSnippet', () => {
  it('writes the claude-personal function with $HOME', () => {
    expect(functionName('personal')).toBe('claude-personal');
    expect(shellSnippet('personal', '~/.claude-personal')).toBe(
      'claude-personal() { CLAUDE_CONFIG_DIR="$HOME/.claude-personal" command claude "$@"; }',
    );
  });

  it('keeps absolute dirs as they are', () => {
    expect(shellSnippet('work', '/opt/claude-work')).toBe(
      'claude-work() { CLAUDE_CONFIG_DIR="/opt/claude-work" command claude "$@"; }',
    );
  });
});

describe('definedInRc', () => {
  const name = 'claude-personal';

  it('finds function and alias definitions', () => {
    expect(definedInRc('claude-personal() { foo; }', name)).toBe(true);
    expect(definedInRc('export A=1\n  claude-personal () {\n  foo\n}', name)).toBe(true);
    expect(definedInRc('function claude-personal {\n}', name)).toBe(true);
    expect(definedInRc("alias claude-personal='CLAUDE_CONFIG_DIR=~/.claude-personal claude'", name)).toBe(
      true,
    );
  });

  it('ignores comments, mentions and longer names', () => {
    expect(definedInRc('# claude-personal() was removed', name)).toBe(false);
    expect(definedInRc('echo claude-personal', name)).toBe(false);
    expect(definedInRc('claude-personal2() { foo; }', name)).toBe(false);
    expect(definedInRc('', name)).toBe(false);
  });
});
