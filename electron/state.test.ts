import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasClaudeTranscript, planRestore, readState, writeState, type SavedTab } from './state';
import type { Config } from '../src/shared/api/types';

const tmp: string[] = [];
const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-state-'));
  tmp.push(d);
  return d;
};
afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const config: Config = {
  language: 'en',
  accounts: { shared: { claudeConfigDir: null }, personal: { claudeConfigDir: '/tmp/claude-personal' } },
  groups: [],
  projects: [
    { id: 'a', name: 'A', group: 'work', account: 'shared', path: '/tmp/a' },
    { id: 'b', name: 'B', group: 'work', account: 'personal', path: '/tmp/b' },
  ],
};

describe('readState / writeState', () => {
  it('round-trips tabs in order', () => {
    const file = path.join(dir(), 'nested', 'state.json');
    const tabs: SavedTab[] = [
      { projectId: 'a', kind: 'claude', account: 'shared', claudeSessionId: ID },
      { projectId: 'b', kind: 'shell' },
    ];
    writeState(tabs, file);
    expect(readState(file)).toEqual(tabs);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('returns nothing for a missing or broken file and drops malformed tabs', () => {
    const d = dir();
    expect(readState(path.join(d, 'missing.json'))).toEqual([]);
    const broken = path.join(d, 'broken.json');
    fs.writeFileSync(broken, '{not json');
    expect(readState(broken)).toEqual([]);
    const odd = path.join(d, 'odd.json');
    fs.writeFileSync(
      odd,
      JSON.stringify({
        version: 1,
        tabs: [
          { projectId: 'a', kind: 'vim' },
          { kind: 'shell' },
          { projectId: 'a', kind: 'claude', claudeSessionId: 'x' },
        ],
      }),
    );
    expect(readState(odd)).toEqual([{ projectId: 'a', kind: 'claude' }]);
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
      [
        { projectId: 'a', kind: 'claude', account: 'shared', claudeSessionId: ID },
        { projectId: 'b', kind: 'claude', account: 'personal', claudeSessionId: ID },
      ],
      config,
      (configDir) => {
        seen.push(configDir);
        return configDir === '/tmp/claude-personal';
      },
    );
    expect(seen).toEqual([path.join(os.homedir(), '.claude'), '/tmp/claude-personal']);
    expect(plan).toEqual([
      { projectId: 'a', kind: 'claude', account: 'shared' },
      { projectId: 'b', kind: 'claude', account: 'personal', resumeClaude: ID },
    ]);
  });

  it('drops removed projects, falls back to the project account, resumes codex, fresh shell', () => {
    const plan = planRestore(
      [
        { projectId: 'gone', kind: 'shell' },
        { projectId: 'b', kind: 'claude', account: 'deleted' },
        { projectId: 'a', kind: 'codex' },
        { projectId: 'a', kind: 'shell' },
      ],
      config,
      () => true,
    );
    expect(plan).toEqual([
      { projectId: 'b', kind: 'claude', account: 'personal' },
      { projectId: 'a', kind: 'codex', resumeCodex: true },
      { projectId: 'a', kind: 'shell' },
    ]);
  });
});
