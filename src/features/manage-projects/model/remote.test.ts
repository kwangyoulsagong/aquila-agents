import { describe, expect, it } from 'vitest';
import { remoteName, toHost, validHost } from './remote';

describe('remote project form', () => {
  it('validates host aliases like main does', () => {
    expect(validHost(' devbox ')).toBe(true);
    expect(validHost('me@10.0.0.2')).toBe(true);
    expect(validHost('-oProxyCommand=x')).toBe(false);
    expect(validHost('a b')).toBe(false);
  });

  it('names the project after the folder, or the host for ~', () => {
    expect(remoteName('~/code/api/', 'devbox')).toBe('api');
    expect(remoteName('~', 'devbox')).toBe('devbox');
    expect(remoteName('', 'devbox')).toBe('devbox');
  });

  it('drops a blank Claude config dir', () => {
    expect(toHost(' devbox ', ' ')).toEqual({ alias: 'devbox' });
    expect(toHost('devbox', '~/.claude-w')).toEqual({ alias: 'devbox', claudeConfigDir: '~/.claude-w' });
  });
});
