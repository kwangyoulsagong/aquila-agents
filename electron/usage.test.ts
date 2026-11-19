import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIVE_HOURS_MS,
  UsageTracker,
  currentBlock,
  learn,
  limitsFor,
  parseUsageLine,
  readTier,
  refreshDue,
  transcriptFiles,
  usageReport,
  weekUsed,
  weigh,
} from './usage';
import type { Config } from '../src/shared/api/types';

const H = 3_600_000;
const T0 = Date.parse('2026-11-19T10:00:00.000Z');

const line = (at: number, id: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    requestId: `req_${id}`,
    message: { id: `msg_${id}`, model: 'claude-opus-5-5', usage },
    ...extra,
  });

describe('weigh', () => {
  it('weights tokens like their price', () => {
    expect(
      weigh({
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 40,
        cache_read_input_tokens: 1000,
      }),
    ).toBe(100 + 50 + 50 + 100);
  });

  it('ignores missing and odd fields', () => {
    expect(weigh({ input_tokens: -5, output_tokens: Number.NaN, service_tier: 3 })).toBe(0);
  });
});

describe('parseUsageLine', () => {
  it('reads an assistant line with usage', () => {
    expect(parseUsageLine(line(T0, 'a', { input_tokens: 10, output_tokens: 2 }))).toEqual({
      at: T0,
      key: 'msg_a:req_a',
      weight: 20,
    });
  });

  it('skips other lines, synthetic messages, broken JSON and empty usage', () => {
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: { content: 'usage' } }))).toBeNull();
    expect(
      parseUsageLine(
        JSON.stringify({
          type: 'assistant',
          timestamp: new Date(T0).toISOString(),
          message: { model: '<synthetic>', usage: { input_tokens: 5 } },
        }),
      ),
    ).toBeNull();
    expect(parseUsageLine('{"usage": ')).toBeNull();
    expect(parseUsageLine(line(T0, 'z', { input_tokens: 0 }))).toBeNull();
  });
});

describe('currentBlock', () => {
  it('starts at the hour of the first message and lasts 5 hours', () => {
    const pts = [
      { at: T0 + 20 * 60_000, weight: 10 },
      { at: T0 + 3 * H, weight: 5 },
    ];
    expect(currentBlock(pts, T0 + 4 * H)).toEqual({ start: T0, used: 15 });
    expect(currentBlock(pts, T0 + 5 * H)).toBeNull();
  });

  it('starts a new block after the previous one ended', () => {
    const pts = [
      { at: T0, weight: 10 },
      { at: T0 + 5 * H + 30 * 60_000, weight: 7 },
    ];
    expect(currentBlock(pts, T0 + 6 * H)).toEqual({ start: T0 + 5 * H, used: 7 });
  });

  it('is null without messages', () => {
    expect(currentBlock([], T0)).toBeNull();
  });
});

describe('weekUsed', () => {
  it('sums the last 7 days only', () => {
    const pts = [
      { at: T0 - 8 * 24 * H, weight: 100 },
      { at: T0 - 6 * 24 * H, weight: 10 },
      { at: T0 - H, weight: 1 },
    ];
    expect(weekUsed(pts, T0)).toBe(11);
  });
});

describe('learned limits', () => {
  it('reads the tier from .claude.json', () => {
    expect(readTier(JSON.stringify({ oauthAccount: { userRateLimitTier: 'max_5x' } }))).toBe('max_5x');
    expect(
      readTier(
        JSON.stringify({ oauthAccount: { userRateLimitTier: null, organizationRateLimitTier: 'org' } }),
      ),
    ).toBe('org');
    expect(readTier('nope')).toBeNull();
  });

  it('counts a first hit as the 5-hour limit', () => {
    expect(learn(undefined, 't', 500, 2000, T0)).toEqual({ tier: 't', fiveHour: 500, at: T0 });
  });

  it('counts a hit well below the known 5-hour limit as the weekly one', () => {
    expect(learn({ tier: 't', fiveHour: 500 }, 't', 100, 4000, T0)).toEqual({
      tier: 't',
      fiveHour: 500,
      weekly: 4000,
      at: T0,
    });
  });

  it('updates the 5-hour limit on a hit near it', () => {
    expect(learn({ tier: 't', fiveHour: 500, weekly: 4000 }, 't', 450, 3000, T0).fiveHour).toBe(450);
  });

  it('forgets limits learned on another plan', () => {
    expect(limitsFor({ tier: 'pro', fiveHour: 100 }, 'max')).toEqual({ tier: 'max' });
    expect(learn({ tier: 'pro', fiveHour: 500 }, 'max', 100, 200, T0)).toEqual({
      tier: 'max',
      fiveHour: 100,
      at: T0,
    });
  });
});

describe('usageReport', () => {
  it('reports percent-ready windows and near', () => {
    const r = usageReport('personal', [{ at: T0, weight: 95 }], { tier: null, fiveHour: 100 }, T0 + H);
    expect(r.fiveHour).toEqual({ used: 95, limit: 100, resetsAt: T0 + FIVE_HOURS_MS });
    expect(r.weekly).toEqual({ used: 95, limit: null, resetsAt: null });
    expect(r.near).toBe(true);
  });

  it('is not near without a learned limit', () => {
    expect(usageReport('shared', [{ at: T0, weight: 1e9 }], { tier: null }, T0).near).toBe(false);
  });
});

describe('refreshDue', () => {
  it('refreshes every minute focused, every 5 unfocused, slower in saver', () => {
    expect(refreshDue(60_000, true, false)).toBe(true);
    expect(refreshDue(60_000, false, false)).toBe(false);
    expect(refreshDue(300_000, false, false)).toBe(true);
    expect(refreshDue(60_000, true, true)).toBe(false);
  });
});

describe('UsageTracker', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-usage-'));
    dirs.push(root);
    const acct = path.join(root, '.claude-personal');
    const proj = path.join(acct, 'projects', '-repo');
    fs.mkdirSync(path.join(proj, 'sess', 'subagents'), { recursive: true });
    fs.writeFileSync(
      path.join(acct, '.claude.json'),
      JSON.stringify({ oauthAccount: { userRateLimitTier: 'max_5x' } }),
    );
    const config: Config = {
      language: 'ko',
      accounts: { personal: { claudeConfigDir: acct } },
      groups: [],
      projects: [],
    };
    return { root, acct, proj, config };
  }

  it('reads transcripts incrementally, dedups content blocks, includes subagents', async () => {
    const { root, proj, config } = setup();
    const main = path.join(proj, 'sess.jsonl');
    const sub = path.join(proj, 'sess', 'subagents', 'agent-1.jsonl');
    const u = { input_tokens: 10 };
    fs.writeFileSync(main, `${line(T0, 'a', u)}\n${line(T0, 'a', u)}\n{"type":"user"}\n`);
    fs.writeFileSync(sub, `${line(T0 + 1000, 'b', u)}\n`);
    expect((await transcriptFiles(path.join(path.dirname(proj)))).sort()).toEqual([main, sub].sort());

    let now = T0 + H;
    const near: string[] = [];
    const tracker = new UsageTracker({
      config: () => config,
      now: () => now,
      limitsPath: path.join(root, 'limits.json'),
      onNear: (x, w) => near.push(`${x.account}:${w}`),
    });
    expect((await tracker.refresh())[0].fiveHour.used).toBe(20);

    // A half-written line is left for the next read.
    const next = line(T0 + 2000, 'c', { input_tokens: 5 });
    fs.appendFileSync(main, next.slice(0, 20));
    expect((await tracker.refresh())[0].fiveHour.used).toBe(20);
    fs.appendFileSync(main, `${next.slice(20)}\n`);
    expect((await tracker.refresh())[0].fiveHour.used).toBe(25);

    // A rate limit makes the current usage 100%; crossing 90% notifies once per block.
    const learned = await tracker.rateLimited('personal');
    expect(learned[0].fiveHour.limit).toBe(25);
    expect(learned[0].near).toBe(true);
    expect(near).toEqual(['personal:fiveHour']);
    await tracker.refresh();
    expect(near).toEqual(['personal:fiveHour']);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'limits.json'), 'utf8'))).toMatchObject({
      personal: { tier: 'max_5x', fiveHour: 25 },
    });

    // After the block ends the 5h window is empty; the week still counts it.
    now = T0 + 6 * H;
    const later = await tracker.refresh();
    expect(later[0].fiveHour).toEqual({ used: 0, limit: 25, resetsAt: null });
    expect(later[0].weekly.used).toBe(25);
  });

  it('skips logged-out accounts', async () => {
    const { root, acct, config } = setup();
    fs.writeFileSync(path.join(acct, '.claude.json'), '{}');
    const tracker = new UsageTracker({ config: () => config, limitsPath: path.join(root, 'l.json') });
    expect(await tracker.refresh()).toEqual([]);
  });
});
