import type { RunInfo, RunState } from '@/shared/api';

/** Dot shown for a run: up = green disc, ended = ring, failed = `!` square, never started = grey. */
export const dotFor = (state: RunState): 'idle' | 'live' | 'stopped' | 'error' =>
  state === 'running' ? 'live' : state === 'exited' ? 'stopped' : state;

/** The run the panel shows: the remembered name when it's still listed, else the first one that's up, else the first. */
export function pickRun(runs: readonly RunInfo[], remembered: string): RunInfo | undefined {
  return runs.find((r) => r.name === remembered) ?? runs.find((r) => r.alive) ?? runs[0];
}
