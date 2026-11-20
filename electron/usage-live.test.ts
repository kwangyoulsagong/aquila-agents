import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseClaudeUsage, parseCodexRollout, parseReset, readCodexLive } from './usage-live';

// 2026-11-20 10:00 in Seoul (01:00 UTC).
const NOW = Date.UTC(2026, 10, 20, 1, 0);
const seoul = (mo: number, d: number, h: number, mi = 0) => Date.UTC(2026, mo, d, h - 9, mi);

const REAL = `You are currently using your subscription to power your Claude Code usage

Current session: 8% used · resets Nov 20 at 1:30pm (Asia/Seoul)
Current week (all models): 77% used · resets Nov 24 at 11am (Asia/Seoul)
Current week (Fable): 0% used · resets Nov 24 at 11am (Asia/Seoul)

What's contributing to your usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 2325 requests · 26 sessions
  66%  Start fresh when you switch tasks · run /clear
`;

describe('parseClaudeUsage', () => {
  it('reads the session and the all-models week from real output', () => {
    expect(parseClaudeUsage(REAL, NOW)).toEqual({
      session: { percent: 8, resetsAt: seoul(10, 20, 13, 30), span: 300 },
      week: { percent: 77, resetsAt: seoul(10, 24, 11), span: 10_080 },
    });
  });
  it('a window without a readable reset keeps its percent', () => {
    expect(parseClaudeUsage('Current session: 12.5% used', NOW)).toEqual({
      session: { percent: 12.5, resetsAt: null, span: 300 },
      week: null,
    });
  });
  it('API key users, logged out and unknown formats → null (the estimate stays)', () => {
    for (const text of ['You are using an API key', '', 'Session usage: 8 percent'])
      expect(parseClaudeUsage(text, NOW)).toBeNull();
  });
});

describe('parseReset', () => {
  it('time only = today in that zone; past = tomorrow', () => {
    expect(parseReset('1:30pm (Asia/Seoul)', NOW)).toBe(seoul(10, 20, 13, 30));
    expect(parseReset('12am (Asia/Seoul)', NOW, 'UTC')).toBe(seoul(10, 21, 0));
  });
  it('a date in December read in January is next year', () => {
    const jan = Date.UTC(2027, 0, 2, 1, 0);
    expect(parseReset('Jan 5 at 9am (UTC)', jan)).toBe(Date.UTC(2027, 0, 5, 9));
    expect(parseReset('Dec 31 at 9am (UTC)', Date.UTC(2026, 11, 30))).toBe(Date.UTC(2026, 11, 31, 9));
  });
  it('another zone and no zone (local)', () => {
    expect(parseReset('Nov 20 at 5pm (America/New_York)', NOW)).toBe(Date.UTC(2026, 10, 20, 22));
    expect(parseReset('Nov 20 at 5pm', NOW, 'UTC')).toBe(Date.UTC(2026, 10, 20, 17));
  });
  it('junk → null', () => {
    for (const t of ['soon', 'Foo 3 at 1pm', '1:30pm (Mars/Base)']) expect(parseReset(t, NOW)).toBeNull();
  });
});

const rollout = (rl: object, ts = '2026-11-19T06:23:40.000Z') =>
  JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: { type: 'token_count', info: {}, rate_limits: rl },
  });

describe('parseCodexRollout', () => {
  it('takes the last rate_limits (real shape)', () => {
    const text = [
      rollout({ primary: { used_percent: 1, window_minutes: 300, resets_at: NOW / 1000 + 600 } }),
      '{"type":"response_item"}',
      rollout({
        limit_id: 'codex',
        primary: { used_percent: 3.5, window_minutes: 300, resets_at: NOW / 1000 + 3600 },
        secondary: { used_percent: 41, window_minutes: 10080, resets_at: NOW / 1000 + 86_400 },
        plan_type: 'plus',
      }),
    ].join('\n');
    expect(parseCodexRollout(text, NOW)).toEqual({
      primary: { percent: 3.5, resetsAt: NOW + 3_600_000, span: 300 },
      secondary: { percent: 41, resetsAt: NOW + 86_400_000, span: 10_080 },
      plan: 'plus',
      at: Date.parse('2026-11-19T06:23:40.000Z'),
    });
  });
  it('a window that reset since the snapshot reads 0%', () => {
    const text = rollout({
      primary: { used_percent: 80, window_minutes: 43200, resets_at: NOW / 1000 - 1 },
      secondary: null,
    });
    expect(parseCodexRollout(text, NOW)?.primary).toEqual({ percent: 0, resetsAt: null, span: 43200 });
  });
  it('cut first line, no limits, null windows → skipped', () => {
    expect(parseCodexRollout('ate_limits":{"primary"', NOW)).toBeNull();
    expect(parseCodexRollout(rollout({ primary: null, secondary: null }), NOW)).toBeNull();
  });
});

describe('readCodexLive', () => {
  let dir = '';
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('reads the newest rollout that has limits', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
    const day = path.join(dir, 'sessions', '2026', '11', '19');
    fs.mkdirSync(day, { recursive: true });
    const old = path.join(day, 'rollout-a.jsonl');
    const neu = path.join(day, 'rollout-b.jsonl');
    fs.writeFileSync(
      old,
      rollout({ primary: { used_percent: 10, window_minutes: 300, resets_at: NOW / 1000 + 60 } }) + '\n',
    );
    fs.writeFileSync(neu, '{"type":"session_meta"}\n'); // newest, but no limits yet
    fs.utimesSync(old, new Date(NOW - 60_000), new Date(NOW - 60_000));
    expect((await readCodexLive(dir, NOW))?.primary?.percent).toBe(10);
  });
  it('no Codex → null', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
    expect(await readCodexLive(dir, NOW)).toBeNull();
  });
});
