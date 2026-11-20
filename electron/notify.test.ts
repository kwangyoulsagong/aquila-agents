import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above the imports, so what it closes over must be hoisted too.
const { shown, badge } = vi.hoisted(() => ({
  shown: [] as { title: string; body: string; click?: () => void }[],
  badge: [] as string[],
}));
vi.mock('electron', () => ({
  app: { dock: { setBadge: (b: string) => badge.push(b) } },
  Notification: class {
    static isSupported = () => true;
    private entry: { title: string; body: string; click?: () => void };
    constructor(o: { title: string; body: string }) {
      this.entry = { ...o };
    }
    on(_event: 'click', cb: () => void) {
      this.entry.click = cb;
    }
    show() {
      shown.push(this.entry);
    }
  },
}));

import {
  Attention,
  Debouncer,
  DEBOUNCE_MS,
  REMIND_MS,
  SETTLE_MS,
  firstLine,
  notificationBody,
  setDockBadge,
  toolSummary,
  wantsAttention,
  type AttentionSession,
} from './notify';
import { translator } from '../src/shared/i18n/dictionary';

const t = translator('en');

describe('firstLine', () => {
  it('takes the first real line, collapsed and cut', () => {
    expect(firstLine('\n\n  Done.   All   tests pass.\nMore')).toBe('Done. All tests pass.');
    expect(firstLine('---\n## Summary\nx')).toBe('Summary');
    expect(firstLine('```\ncode')).toBe('code');
    expect(firstLine('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(firstLine(undefined)).toBe('');
  });
});

describe('toolSummary', () => {
  it('names the tool and what it does', () => {
    expect(toolSummary('Bash', { command: 'npm install\nnpm test', description: 'install' })).toBe(
      'Bash: npm install',
    );
    expect(toolSummary('Edit', { file_path: 'src/app.ts', old_string: 'a' })).toBe('Edit: src/app.ts');
    expect(toolSummary('WebFetch', { url: 'https://x.dev' })).toBe('WebFetch: https://x.dev');
    expect(toolSummary('mcp__x__y', {})).toBe('mcp__x__y');
    expect(toolSummary('Bash', null)).toBe('Bash');
    expect(toolSummary(undefined, { command: 'ls' })).toBe('');
  });
});

describe('notificationBody', () => {
  it('kind · what — detail', () => {
    expect(notificationBody({ t, kind: 'claude', status: 'waiting', detail: 'Bash: npm install' })).toBe(
      'Claude · Needs input — Bash: npm install',
    );
    expect(notificationBody({ t, kind: 'codex', status: 'done' })).toBe('Codex · Done');
    expect(notificationBody({ t, kind: 'claude', status: 'error', reason: 'rateLimit' })).toBe(
      'Claude · Error: Rate limited',
    );
    expect(notificationBody({ t, kind: 'claude', status: 'waiting', remindMinutes: 10 })).toBe(
      'Claude · Still waiting after 10 min',
    );
  });
  it('names the session by its title when it has one (T43)', () => {
    expect(notificationBody({ t, kind: 'claude', title: 'Add dark mode', status: 'done' })).toBe(
      'Add dark mode · Done',
    );
  });
});

describe('wantsAttention', () => {
  it('waiting, done and errors other than exit', () => {
    expect(wantsAttention('waiting')).toBe(true);
    expect(wantsAttention('done')).toBe(true);
    expect(wantsAttention('error', 'auth')).toBe(true);
    expect(wantsAttention('error', 'exit')).toBe(false);
    expect(wantsAttention('working')).toBe(false);
    expect(wantsAttention('stopped')).toBe(false);
  });
});

describe('Debouncer', () => {
  it('drops the same status within the window, not a different one', () => {
    const d = new Debouncer();
    expect(d.allow('a', 'done', 0)).toBe(true);
    expect(d.allow('a', 'done', DEBOUNCE_MS - 1)).toBe(false);
    expect(d.allow('b', 'done', 1)).toBe(true);
    expect(d.allow('a', 'waiting', 2)).toBe(true);
    expect(d.allow('a', 'waiting', 2 + DEBOUNCE_MS)).toBe(true);
  });
});

describe('setDockBadge', () => {
  it('shows the count, empty at zero', () => {
    badge.length = 0;
    setDockBadge(3);
    setDockBadge(0);
    expect(badge).toEqual(['3', '']);
  });
});

describe('Attention', () => {
  let live: Map<string, AttentionSession>;
  let onScreen: Set<string>;
  let focused: string[];
  let attention: InstanceType<typeof Attention>;
  const put = (s: AttentionSession) => {
    live.set(s.id, s);
    attention.changed(s);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    shown.length = 0;
    live = new Map();
    onScreen = new Set();
    focused = [];
    attention = new Attention({
      get: (id) => live.get(id),
      onScreen: (id) => onScreen.has(id),
      t: () => t,
      focus: (id) => focused.push(id),
    });
  });
  afterEach(() => {
    attention.dispose();
    vi.useRealTimers();
  });

  const waiting = (since = Date.now(), detail?: string): AttentionSession => ({
    id: 'a',
    projectName: 'SALT',
    kind: 'claude',
    status: 'waiting',
    since,
    ...(detail ? { detail } : {}),
  });

  it('notifies after settling, with a detail that arrived meanwhile; click focuses the session', () => {
    put(waiting(0));
    vi.advanceTimersByTime(SETTLE_MS / 2);
    put(waiting(0, 'Bash: npm install'));
    vi.advanceTimersByTime(SETTLE_MS);
    expect(shown.map((n) => [n.title, n.body])).toEqual([
      ['SALT', 'Claude · Needs input — Bash: npm install'],
    ]);
    shown[0].click?.();
    expect(focused).toEqual(['a']);
  });

  it('skips a flap and a session already on screen', () => {
    put(waiting(0));
    put({ ...waiting(10), status: 'working' });
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(shown).toHaveLength(0);
    onScreen.add('a');
    put({ ...waiting(20), status: 'done' });
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(shown).toHaveLength(0);
  });

  it('does not repeat the same status within the debounce window', () => {
    put({ ...waiting(0), status: 'done' });
    vi.advanceTimersByTime(SETTLE_MS);
    put({ ...waiting(SETTLE_MS), status: 'working' });
    put({ ...waiting(SETTLE_MS + 1), status: 'done' });
    vi.advanceTimersByTime(SETTLE_MS);
    expect(shown).toHaveLength(1);
  });

  it('reminds once after REMIND_MS of waiting off screen', () => {
    put(waiting(0));
    vi.advanceTimersByTime(REMIND_MS + 1000);
    expect(shown.map((n) => n.body)).toEqual(['Claude · Needs input', 'Claude · Still waiting after 10 min']);
    vi.advanceTimersByTime(REMIND_MS * 3);
    expect(shown).toHaveLength(2);
  });

  it('no reminder once the session moved on or is gone', () => {
    put(waiting(0));
    vi.advanceTimersByTime(SETTLE_MS);
    put({ ...waiting(1000), status: 'working' });
    vi.advanceTimersByTime(REMIND_MS);
    put(waiting(REMIND_MS + 2000));
    vi.advanceTimersByTime(SETTLE_MS);
    live.delete('a');
    attention.forget('a');
    vi.advanceTimersByTime(REMIND_MS * 2);
    expect(shown).toHaveLength(2); // the two waiting notifications, no reminder
  });
});
