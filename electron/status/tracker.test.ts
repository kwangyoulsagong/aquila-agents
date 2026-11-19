import { describe, expect, it } from 'vitest';
import { isTyped, StatusTracker } from './tracker';

const report = (t: StatusTracker, state: string, now = 0, extra: Record<string, string> = {}) =>
  t.osc({ state, app: 'claude-code', ...extra }, now);

describe('StatusTracker with OSC 7501', () => {
  it('follows reports and ignores hooks for status once the program reports', () => {
    const t = new StatusTracker(false);
    report(t, 'working');
    expect(t.current().status).toBe('working');
    expect(t.hook({ event: 'Stop' })).toBe(false); // 7501 decides
    report(t, 'blocked', 0, { kind: 'permission' });
    expect(t.current().status).toBe('waiting');
    report(t, 'done');
    expect(t.current()).toEqual({ status: 'done', estimated: false });
  });

  it('ignores unknown states', () => {
    const t = new StatusTracker(false);
    expect(report(t, 'sleeping')).toBe(false);
    expect(t.reporting).toBe(false);
  });

  it('shows the most urgent record (background tasks have their own id)', () => {
    const t = new StatusTracker(false);
    report(t, 'done');
    report(t, 'working', 0, { id: 'bash/1' });
    expect(t.current().status).toBe('working');
    t.osc({ state: 'clear', id: 'bash/1' }, 0);
    expect(t.current().status).toBe('done');
  });

  it('stays idle after the user has seen a done that is reported again', () => {
    const t = new StatusTracker(false);
    report(t, 'done');
    expect(t.seen()).toBe(true);
    expect(report(t, 'done')).toBe(false);
    expect(t.current().status).toBe('idle');
  });

  it('turns idle after Esc / Ctrl+C into stopped', () => {
    const t = new StatusTracker(false);
    report(t, 'working', 0);
    expect(t.input('\x1b', 1000)).toBe(false); // waits for the program's report
    report(t, 'idle', 2000);
    expect(t.current().status).toBe('stopped');
    report(t, 'working', 3000);
    report(t, 'idle', 60_000);
    expect(t.current().status).toBe('idle');
  });

  it('keeps a StopFailure error over a later done, until a new turn', () => {
    const t = new StatusTracker(false);
    report(t, 'working');
    t.hook({ event: 'StopFailure', error: 'rate_limit' });
    expect(t.current()).toEqual({ status: 'error', estimated: false, reason: 'rateLimit' });
    report(t, 'done');
    expect(t.current().status).toBe('error');
    report(t, 'working');
    expect(t.current().status).toBe('working');
  });

  it('falls back after a clear of everything (the program exited) and shows stopped', () => {
    const t = new StatusTracker(true);
    report(t, 'idle');
    t.osc({ state: 'clear' }, 0);
    expect(t.reporting).toBe(false);
    expect(t.current().status).toBe('stopped');
  });
});

describe('StatusTracker with hooks (Claude without 7501)', () => {
  it('maps hook events', () => {
    const t = new StatusTracker(false);
    t.hook({ event: 'UserPromptSubmit' });
    expect(t.current().status).toBe('working');
    t.hook({ event: 'PermissionRequest' });
    expect(t.current().status).toBe('waiting');
    t.hook({ event: 'PostToolUse' });
    expect(t.current().status).toBe('working');
    t.hook({ event: 'Stop' });
    expect(t.current().status).toBe('done');
  });

  it('never treats idle_prompt as waiting', () => {
    const t = new StatusTracker(false);
    expect(t.hook({ event: 'Notification', notificationType: 'idle_prompt' })).toBe(false);
    t.hook({ event: 'Notification', notificationType: 'elicitation_dialog' });
    expect(t.current().status).toBe('waiting');
  });

  it('stays working when Stop arrives while subagents run', () => {
    const t = new StatusTracker(false);
    t.hook({ event: 'UserPromptSubmit' });
    t.hook({ event: 'SubagentStart' });
    t.hook({ event: 'SubagentStart' });
    t.hook({ event: 'Stop' });
    expect(t.current().status).toBe('working');
    t.hook({ event: 'SubagentStop' });
    expect(t.current().status).toBe('working');
    t.hook({ event: 'SubagentStop' });
    expect(t.current().status).toBe('done');
  });

  it('clears waiting on a typed key, and Esc / Ctrl+C means stopped', () => {
    const t = new StatusTracker(false);
    t.hook({ event: 'PermissionRequest' });
    expect(t.input('\x1b[I', 0)).toBe(false); // focus report, not typing
    t.input('1', 0);
    expect(t.current().status).toBe('working');
    t.input('\x03', 0);
    expect(t.current().status).toBe('stopped');
  });

  it('SessionEnd is stopped unless it was /clear', () => {
    const t = new StatusTracker(false);
    t.hook({ event: 'UserPromptSubmit' });
    expect(t.hook({ event: 'SessionEnd', reason: 'clear' })).toBe(false);
    t.hook({ event: 'SessionEnd', reason: 'prompt_input_exit' });
    expect(t.current().status).toBe('stopped');
  });
});

describe('StatusTracker heuristic (codex without 7501, shell)', () => {
  it('guesses working after 3 s of output and an estimated done when it goes quiet', () => {
    const t = new StatusTracker(true);
    for (let ms = 0; ms <= 4000; ms += 500) t.output(ms);
    t.tick(4000);
    expect(t.current().status).toBe('working');
    t.tick(8000);
    expect(t.current()).toEqual({ status: 'done', estimated: true });
  });

  it('is off for Claude and once a program reports', () => {
    const claude = new StatusTracker(false);
    for (let ms = 0; ms <= 4000; ms += 500) claude.output(ms);
    expect(claude.tick(4000)).toBe(false);

    const codex = new StatusTracker(true);
    report(codex, 'idle');
    for (let ms = 0; ms <= 4000; ms += 500) codex.output(ms);
    expect(codex.tick(4000)).toBe(false);
  });

  it('Ctrl+C while busy is stopped and the quiet afterwards is not done', () => {
    const t = new StatusTracker(true);
    for (let ms = 0; ms <= 4000; ms += 500) t.output(ms);
    t.tick(4000);
    t.input('\x03', 4100);
    t.tick(9000);
    expect(t.current().status).toBe('stopped');
  });
});

describe('exit and input', () => {
  it('exit 0 / 130 / signal = stopped, other codes = error', () => {
    const t = new StatusTracker(true);
    t.exit(130);
    expect(t.current().status).toBe('stopped');
    t.exit(0, 1);
    expect(t.current().status).toBe('stopped');
    t.exit(1);
    expect(t.current()).toEqual({ status: 'error', estimated: false, reason: 'exit' });
  });

  it('tells typing from terminal replies', () => {
    expect(isTyped('a')).toBe(true);
    expect(isTyped('\r')).toBe(true);
    expect(isTyped('\x1b[A')).toBe(true);
    expect(isTyped('\x1b[I')).toBe(false);
    expect(isTyped('\x1b[?62;22c')).toBe(false);
    expect(isTyped('\x1b[12;40R')).toBe(false);
    expect(isTyped('\x1b[<0;10;5M')).toBe(false);
    expect(isTyped('\x1b]11;rgb:0000/0000/0000\x1b\\')).toBe(false);
  });
});
