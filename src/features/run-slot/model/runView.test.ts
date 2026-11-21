import { describe, expect, it } from 'vitest';
import type { RunInfo } from '@/shared/api';
import { dotFor, pickRun } from './runView';

const run = (name: string, alive = false): RunInfo => ({
  id: name,
  name,
  command: name,
  state: alive ? 'running' : 'idle',
  alive,
});

describe('dotFor', () => {
  it('maps run states to dots', () => {
    expect(dotFor('running')).toBe('live');
    expect(dotFor('exited')).toBe('stopped');
    expect(dotFor('error')).toBe('error');
    expect(dotFor('idle')).toBe('idle');
  });
});

describe('pickRun', () => {
  it('prefers the remembered name, then a live run, then the first', () => {
    const runs = [run('web'), run('test', true)];
    expect(pickRun(runs, 'web')?.name).toBe('web');
    expect(pickRun(runs, 'gone')?.name).toBe('test');
    expect(pickRun([run('a'), run('b')], '')?.name).toBe('a');
    expect(pickRun([], 'x')).toBeUndefined();
  });
});
