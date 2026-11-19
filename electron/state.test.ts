import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatRestored,
  hasClaudeTranscript,
  mapLayout,
  planRestore,
  pruneScrollback,
  readScrollback,
  readState,
  removeScrollback,
  visibleKeys,
  writeScrollback,
  writeState,
  SCROLLBACK_MAX_BYTES,
  type SavedTab,
} from './state';
import type { Config, SavedLayout } from '../src/shared/api/types';

const tmp: string[] = [];
const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-state-'));
  tmp.push(d);
  return d;
};
afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CODEX = '01a1ebf4-1ccd-7221-a7f6-a2d6f4af3b20';
const K1 = '11111111-1111-4111-8111-111111111111';
const K2 = '22222222-2222-4222-8222-222222222222';
const K3 = '33333333-3333-4333-8333-333333333333';
const config: Config = {
  language: 'en',
  accounts: { shared: { claudeConfigDir: null }, personal: { claudeConfigDir: '/tmp/claude-personal' } },
  groups: [],
  projects: [
    { id: 'a', name: 'A', group: 'work', account: 'shared', path: '/tmp/a' },
    { id: 'b', name: 'B', group: 'work', account: 'personal', path: '/tmp/b' },
  ],
};
const layout: SavedLayout = {
  root: { kind: 'split', dir: 'row', a: { kind: 'leaf', sessionId: K1 }, b: { kind: 'leaf', sessionId: K3 } },
  focused: 1,
};

describe('readState / writeState', () => {
  it('round-trips tabs in order, with the layout', () => {
    const file = path.join(dir(), 'nested', 'state.json');
    const tabs: SavedTab[] = [
      { key: K1, projectId: 'a', kind: 'claude', account: 'shared', claudeSessionId: ID },
      {
        key: K2,
        projectId: 'a',
        kind: 'claude',
        account: 'shared',
        worktree: { path: '/tmp/a-wt/feat/x', branch: 'feat/x' },
      },
      { key: K3, projectId: 'b', kind: 'codex', codexSessionId: CODEX },
    ];
    writeState(tabs, layout, file);
    expect(readState(file)).toEqual({ tabs, layout, legacy: false });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('returns nothing for a missing or broken file and drops malformed tabs', () => {
    const d = dir();
    const empty = { tabs: [], layout: null, legacy: false };
    expect(readState(path.join(d, 'missing.json'))).toEqual(empty);
    const broken = path.join(d, 'broken.json');
    fs.writeFileSync(broken, '{not json');
    expect(readState(broken)).toEqual(empty);
    const odd = path.join(d, 'odd.json');
    fs.writeFileSync(
      odd,
      JSON.stringify({
        version: 2,
        tabs: [
          { projectId: 'a', kind: 'vim' },
          { kind: 'shell' },
          {
            key: '../../etc/x',
            projectId: 'a',
            kind: 'claude',
            claudeSessionId: 'x',
            worktree: { path: 'rel/x', branch: 'x' },
          },
        ],
        layout: { root: { kind: 'leaf', sessionId: '../../etc/x' }, focused: 0 },
      }),
    );
    const read = readState(odd);
    expect(read.tabs).toHaveLength(1);
    expect(read.tabs[0]).toMatchObject({ projectId: 'a', kind: 'claude' });
    expect(read.tabs[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(read.tabs[0]).not.toHaveProperty('claudeSessionId');
    // The layout's leaf named a key that isn't a saved tab: the pane stays, empty.
    expect(read.layout).toEqual({ root: { kind: 'leaf', sessionId: null }, focused: 0 });
  });

  it('reads a T4 (version 1) file as legacy and gives its tabs keys', () => {
    const file = path.join(dir(), 'state.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, tabs: [{ projectId: 'a', kind: 'codex' }] }));
    const read = readState(file);
    expect(read.legacy).toBe(true);
    expect(read.layout).toBeNull();
    expect(read.tabs[0].key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('mapLayout', () => {
  it('maps leaves and keeps the focus in range', () => {
    expect(mapLayout(layout, (k) => (k === K1 ? 's1' : null))).toEqual({
      root: {
        kind: 'split',
        dir: 'row',
        a: { kind: 'leaf', sessionId: 's1' },
        b: { kind: 'leaf', sessionId: null },
      },
      focused: 1,
    });
    expect(mapLayout({ ...layout, focused: 7 }, (k) => k)?.focused).toBe(0);
  });

  it('rejects malformed trees and more than 4 panes', () => {
    expect(mapLayout(null, (k) => k)).toBeNull();
    expect(mapLayout({ root: { kind: 'split', dir: 'diagonal', a: {}, b: {} } }, (k) => k)).toBeNull();
    const leaf = { kind: 'leaf', sessionId: null };
    const four = {
      kind: 'split',
      dir: 'row',
      a: { kind: 'split', dir: 'row', a: leaf, b: leaf },
      b: { kind: 'split', dir: 'row', a: leaf, b: leaf },
    };
    expect(mapLayout({ root: four, focused: 3 }, (k) => k)).not.toBeNull();
    expect(
      mapLayout({ root: { kind: 'split', dir: 'row', a: four, b: leaf }, focused: 0 }, (k) => k),
    ).toBeNull();
  });
});

describe('hasClaudeTranscript', () => {
  it('finds <id>.jsonl in any project dir', () => {
    const configDir = dir();
    expect(hasClaudeTranscript(configDir, ID)).toBe(false);
    const project = path.join(configDir, 'projects', '-tmp-a');
    fs.mkdirSync(project, { recursive: true });
    expect(hasClaudeTranscript(configDir, ID)).toBe(false);
    fs.writeFileSync(path.join(project, `${ID}.jsonl`), '');
    expect(hasClaudeTranscript(configDir, ID)).toBe(true);
  });
});

describe('planRestore', () => {
  it('resumes Claude only when the transcript exists, in the account config dir', () => {
    const seen: string[] = [];
    const plan = planRestore(
      {
        legacy: false,
        tabs: [
          { key: K1, projectId: 'a', kind: 'claude', account: 'shared', claudeSessionId: ID },
          { key: K2, projectId: 'b', kind: 'claude', account: 'personal', claudeSessionId: ID },
        ],
      },
      config,
      (configDir) => {
        seen.push(configDir);
        return configDir === '/tmp/claude-personal';
      },
    );
    expect(seen).toEqual([path.join(os.homedir(), '.claude'), '/tmp/claude-personal']);
    expect(plan).toEqual([
      { key: K1, projectId: 'a', kind: 'claude', account: 'shared' },
      { key: K2, projectId: 'b', kind: 'claude', account: 'personal', resumeClaude: ID },
    ]);
  });

  it('drops removed projects, falls back to the project account, codex by id, cold shell', () => {
    const plan = planRestore(
      {
        legacy: false,
        tabs: [
          { key: K1, projectId: 'gone', kind: 'shell' },
          { key: K1, projectId: 'b', kind: 'claude', account: 'deleted' },
          { key: K2, projectId: 'a', kind: 'codex', codexSessionId: CODEX },
          { key: K3, projectId: 'a', kind: 'codex' },
          { key: K3, projectId: 'a', kind: 'shell' },
        ],
      },
      config,
      () => true,
    );
    expect(plan).toEqual([
      { key: K1, projectId: 'b', kind: 'claude', account: 'personal' },
      { key: K2, projectId: 'a', kind: 'codex', resumeCodexId: CODEX },
      { key: K3, projectId: 'a', kind: 'codex' },
      { key: K3, projectId: 'a', kind: 'shell', cold: true },
    ]);
  });

  it('a T4 codex tab without an id resumes --last', () => {
    expect(planRestore({ legacy: true, tabs: [{ key: K1, projectId: 'a', kind: 'codex' }] }, config)).toEqual(
      [{ key: K1, projectId: 'a', kind: 'codex', resumeCodex: true }],
    );
  });

  it('keeps a worktree tab in its worktree, drops it when the folder is gone', () => {
    const wt = { path: '/tmp/a-wt/feat', branch: 'feat' };
    const gone = { path: '/tmp/a-wt/old', branch: 'old' };
    const plan = planRestore(
      {
        legacy: false,
        tabs: [
          { key: K1, projectId: 'a', kind: 'claude', worktree: wt, claudeSessionId: ID },
          { key: K2, projectId: 'a', kind: 'claude', worktree: gone },
        ],
      },
      config,
      () => true,
      (d) => d === wt.path,
    );
    expect(plan).toEqual([
      { key: K1, projectId: 'a', kind: 'claude', account: 'shared', worktree: wt, resumeClaude: ID },
    ]);
  });
});

describe('visibleKeys', () => {
  const plans = [
    { key: K1, projectId: 'b', kind: 'shell' as const },
    { key: K2, projectId: 'a', kind: 'shell' as const },
    { key: K3, projectId: 'a', kind: 'shell' as const },
  ];
  it('spawns the tabs in the saved panes', () => {
    expect(visibleKeys(plans, layout, config)).toEqual(new Set([K1, K3]));
  });
  it('without a layout, the first tab of the first project', () => {
    expect(visibleKeys(plans, null, config)).toEqual(new Set([K2]));
    expect(visibleKeys([], null, config)).toEqual(new Set());
  });
});

describe('scrollback files', () => {
  it('writes, reads, removes and prunes by tab key only', () => {
    const d = dir();
    writeScrollback(K1, 'hello\nworld\n', d);
    writeScrollback(K2, 'two', d);
    writeScrollback('../evil', 'x', d);
    expect(readScrollback(K1, d)?.text).toBe('hello\nworld\n');
    expect(readScrollback('../evil', d)).toBeNull();
    expect(fs.readdirSync(d).sort()).toEqual([`${K1}.txt`, `${K2}.txt`]);
    removeScrollback(K2, d);
    expect(readScrollback(K2, d)).toBeNull();
    writeScrollback(K3, 'three', d);
    pruneScrollback(new Set([K3]), d);
    expect(fs.readdirSync(d)).toEqual([`${K3}.txt`]);
  });

  it('keeps the tail of a long snapshot, cut at a line', () => {
    const d = dir();
    const line = `${'x'.repeat(99)}\n`;
    writeScrollback(K1, line.repeat((SCROLLBACK_MAX_BYTES / 100) * 2) + 'last', d);
    const text = readScrollback(K1, d)!.text;
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SCROLLBACK_MAX_BYTES);
    expect(text.startsWith('x')).toBe(true);
    expect(text.endsWith('last')).toBe(true);
  });

  it('formats dimmed, strips control characters, ends with the banner', () => {
    expect(formatRestored('a\x1b[31mb\nc\n\n', 'Previous output')).toBe(
      '\x1b[0m\x1b[2ma[31mb\r\nc\r\n── Previous output ──\x1b[0m\r\n\r\n',
    );
  });
});
