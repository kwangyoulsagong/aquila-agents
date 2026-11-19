import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureMcpConfig,
  extractJson,
  FIGMA_MCP_URL,
  figmaArgs,
  parsePlans,
  parseProbe,
  readProfiles,
  writeProfile,
} from './figma';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-figma-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const probe = (result: string, extra: object = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, ...extra });

describe('mcp config + args', () => {
  it('writes the server file once and rewrites it when changed', () => {
    const file = path.join(tmp(), 'mcp', 'figma.json');
    ensureMcpConfig(file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      mcpServers: { figma: { type: 'http', url: FIGMA_MCP_URL } },
    });
    fs.writeFileSync(file, '{}');
    ensureMcpConfig(file);
    expect(fs.readFileSync(file, 'utf8')).toContain(FIGMA_MCP_URL);
  });

  it('builds shell-safe args for claude and codex', () => {
    expect(figmaArgs('claude', "/Users/me/it's/figma.json")).toBe(`--mcp-config "/Users/me/it's/figma.json"`);
    // The shell must hand codex exactly key="url" (TOML string).
    const codex = figmaArgs('codex');
    const argv = execFileSync('/bin/sh', ['-c', `printf '%s\\n' ${codex}`])
      .toString()
      .trim()
      .split('\n');
    expect(argv).toEqual(['-c', `mcp_servers.figma.url="${FIGMA_MCP_URL}"`]);
  });
});

describe('extractJson', () => {
  it('finds the object inside prose or a code fence, skipping braces in strings', () => {
    expect(extractJson('Here:\n```json\n{"a":"x}y","b":[1,{"c":2}]}\n```')).toEqual({
      a: 'x}y',
      b: [1, { c: 2 }],
    });
    expect(extractJson('no json {here')).toBeUndefined();
  });
});

describe('parsePlans', () => {
  it('reads a plans array with seat and tier under various key names', () => {
    expect(
      parsePlans({
        email: 'a@b.c',
        plans: [
          { name: 'Acme', tier: 'organization', seat: 'Dev' },
          { team_name: 'Home', plan_type: 'starter' },
        ],
      }),
    ).toEqual([
      { name: 'Acme', tier: 'organization', seat: 'Dev' },
      { name: 'Home', tier: 'starter', seat: 'unknown' },
    ]);
  });
  it('a top-level seat is one plan; nothing known is none', () => {
    expect(parsePlans({ email: 'a@b.c', seatType: 'full' })).toEqual([
      { name: 'unknown', tier: 'unknown', seat: 'full' },
    ]);
    expect(parsePlans({ email: 'a@b.c' })).toEqual([]);
    expect(parsePlans(['x'])).toEqual([]);
  });
});

// Shape of a real Figma `whoami` reply (2026-11), values made up.
const REAL_SHAPE = {
  whoami: {
    user_id: '1',
    handle: 'Ada Lovelace',
    email: 'ada@example.com',
    code_layers_enabled: true,
    plans: [
      {
        name: "Ada's team",
        seat: 'View',
        tier: 'starter',
        key: 'team::1',
        role: 'admin',
        specs_enabled: true,
      },
      { name: 'Acme Design', seat: 'Full', tier: 'pro', key: 'team::2', role: 'guest', specs_enabled: true },
    ],
  },
  instructions: 'For more details on rate limits and access, refer to https://developers.figma.com/docs/…',
};

describe('real whoami shape', () => {
  it('finds the nested plans with seat (not role) and tier', () => {
    expect(parseProbe(probe(JSON.stringify(REAL_SHAPE)), 3)).toEqual({
      state: 'connected',
      checkedAt: 3,
      email: 'ada@example.com',
      handle: 'Ada Lovelace',
      plans: [
        { name: "Ada's team", tier: 'starter', seat: 'View' },
        { name: 'Acme Design', tier: 'pro', seat: 'Full' },
      ],
    });
  });
});

describe('parseProbe', () => {
  it('connected: email, handle and plans', () => {
    const p = parseProbe(
      probe('{"user":{"email":"me@x.io","handle":"me"},"plans":[{"name":"X","tier":"pro","seat":"view"}]}'),
      5,
    );
    expect(p).toEqual({
      state: 'connected',
      checkedAt: 5,
      email: 'me@x.io',
      handle: 'me',
      plans: [{ name: 'X', tier: 'pro', seat: 'view' }],
    });
  });
  it('needsAuth when Claude has no figma tool (not logged in)', () => {
    expect(parseProbe(probe('NO_FIGMA_TOOL\n\nThe Figma MCP server isn’t authorized yet.'), 1).state).toBe(
      'needsAuth',
    );
  });
  it('error for non-JSON output, an error result or prose without data', () => {
    expect(parseProbe('Error: boom', 1)).toMatchObject({ state: 'error', error: 'Error: boom' });
    expect(parseProbe(probe('rate limited', { is_error: true }), 1)).toMatchObject({
      state: 'error',
      error: 'rate limited',
    });
    expect(parseProbe(probe('I could not do that.'), 1).state).toBe('error');
  });
});

describe('profile cache', () => {
  it('keeps one profile per account and drops broken entries', () => {
    const file = path.join(tmp(), 'figma-profile.json');
    expect(readProfiles(file)).toEqual({});
    writeProfile('shared', { state: 'needsAuth', checkedAt: 1, plans: [] }, file);
    writeProfile('work', { state: 'connected', checkedAt: 2, plans: [], email: 'w@x' }, file);
    expect(Object.keys(readProfiles(file))).toEqual(['shared', 'work']);
    fs.writeFileSync(file, JSON.stringify({ a: { state: 'weird' }, b: { state: 'error', plans: 'x' } }));
    expect(readProfiles(file)).toEqual({ b: { state: 'error', checkedAt: 0, plans: [] } });
  });
});
