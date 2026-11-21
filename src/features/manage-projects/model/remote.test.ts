import { describe, expect, it } from 'vitest';
import { remoteName, toHost, validHost, addBlocker, childDir, parentDir } from './remote';

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

describe('remote add guard and folder paths (T56)', () => {
  const tools = (tmux: boolean) => [
    { tool: 'tmux' as const, install: 'x', ...(tmux ? { path: '/usr/bin/tmux' } : {}) },
  ];
  it('blocks when unreachable or without tmux', () => {
    expect(addBlocker({ reachable: false, tools: [] })).toBe('unreachable');
    expect(addBlocker({ reachable: true, tools: tools(false) })).toBe('tmux');
    expect(addBlocker({ reachable: true, tools: tools(true) })).toBeNull();
  });
  it('walks up and down host paths', () => {
    expect(parentDir('/home/u/code/')).toBe('/home/u');
    expect(parentDir('/home')).toBe('/');
    expect(parentDir('/')).toBe('/');
    expect(childDir('/home/u/', 'app')).toBe('/home/u/app');
    expect(childDir('/', 'srv')).toBe('/srv');
  });
});
