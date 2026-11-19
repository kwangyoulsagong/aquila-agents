import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assignRollouts, findRollouts, parseRolloutHead, type CodexTab } from './codex';

const ID1 = '01a1ebf4-1ccd-7221-a7f6-a2d6f4af3b20';
const ID2 = '01a1ebf4-1ccd-7221-a7f6-a2d6f4af3b21';

const head = (id: string, cwd: string, ts: string) =>
  `${JSON.stringify({
    timestamp: ts,
    type: 'session_meta',
    payload: {
      session_id: id,
      id,
      timestamp: ts,
      cwd,
      originator: 'codex-tui',
      base_instructions: { text: 'x' },
    },
  })}\n{"type":"response_item"}\n`;

const tmp: string[] = [];
afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe('parseRolloutHead', () => {
  it('reads id, cwd and start time from session_meta', () => {
    expect(parseRolloutHead(head(ID1, '/tmp/a "q"', '2026-11-18T00:00:06.349Z'))).toEqual({
      id: ID1,
      cwd: '/tmp/a "q"',
      startedAt: Date.parse('2026-11-18T00:00:06.349Z'),
    });
  });
  it('ignores other lines and truncated heads', () => {
    expect(parseRolloutHead('{"type":"response_item"}\n')).toBeNull();
    expect(parseRolloutHead('{"type":"session_meta","payload":{"id":"x"')).toBeNull();
  });
});

describe('findRollouts', () => {
  it('lists rollouts started since, from the local day folders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-codex-'));
    tmp.push(root);
    const now = new Date();
    const day = path.join(
      root,
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    );
    fs.mkdirSync(day, { recursive: true });
    const since = now.getTime() - 60_000;
    fs.writeFileSync(path.join(day, `rollout-new-${ID1}.jsonl`), head(ID1, '/tmp/a', now.toISOString()));
    fs.writeFileSync(
      path.join(day, `rollout-old-${ID2}.jsonl`),
      head(ID2, '/tmp/a', new Date(since - 1000).toISOString()),
    );
    fs.writeFileSync(path.join(day, 'notes.txt'), 'x');
    expect(findRollouts(since, root).map((r) => r.id)).toEqual([ID1]);
  });
});

describe('assignRollouts', () => {
  const r = (id: string, cwd: string, startedAt: number) => ({ id, cwd, startedAt });

  it('gives a rollout to the tab where Enter was typed last before it started', () => {
    const tabs: CodexTab[] = [
      { id: 't1', cwd: '/a', spawnedAt: 0, lastSubmit: 50 },
      { id: 't2', cwd: '/a', spawnedAt: 10, lastSubmit: 90 },
    ];
    expect(assignRollouts(tabs, [r(ID1, '/a', 100)], new Set())).toEqual(new Map([['t2', ID1]]));
  });

  it('two rollouts in one folder go to two tabs; claimed ids and other folders are skipped', () => {
    const tabs: CodexTab[] = [
      { id: 't1', cwd: '/a', spawnedAt: 0, lastSubmit: 100 },
      { id: 't2', cwd: '/a', spawnedAt: 10, lastSubmit: 300 },
      { id: 't3', cwd: '/b', spawnedAt: 0 },
    ];
    const claimed = new Set([ID2]);
    expect(assignRollouts(tabs, [r(ID1, '/a', 101), r(ID2, '/a', 301)], claimed)).toEqual(
      new Map([['t1', ID1]]),
    );
    expect(assignRollouts(tabs, [r(ID1, '/a', 101), r(ID2, '/a', 301)], new Set())).toEqual(
      new Map([
        ['t1', ID1],
        ['t2', ID2],
      ]),
    );
  });

  it('no Enter seen: the oldest tab; a rollout older than the tab is not its', () => {
    const tabs: CodexTab[] = [
      { id: 't1', cwd: '/a', spawnedAt: 20 },
      { id: 't2', cwd: '/a', spawnedAt: 10 },
    ];
    expect(assignRollouts(tabs, [r(ID1, '/a', 5)], new Set())).toEqual(new Map());
    expect(assignRollouts(tabs, [r(ID1, '/a', 30)], new Set())).toEqual(new Map([['t2', ID1]]));
  });
});
