import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cpuPercent,
  cspFor,
  eventAllowed,
  EXT_EVENT,
  EXT_REQUEST,
  fileFor,
  methodAllowed,
  parseManifest,
  parseFloatPrefs,
  addedBeyond,
  grantCovers,
  parsePrefs,
  placeFloat,
  OPACITY_MIN,
  FLOAT_MIN,
  requestAllowed,
  safeRelative,
  slugFor,
  statusCounts,
  templateFiles,
  usageView,
} from './extensions';
import { IPC } from '../src/shared/api/types';

describe('parseManifest', () => {
  it('reads a full manifest', () => {
    const { manifest, problems } = parseManifest(
      JSON.stringify({
        name: 'System meter',
        description: 'CPU and memory',
        version: '1.0.0',
        glyph: '▥',
        entry: 'pages/meter.html',
        permissions: ['system', 'sessions:status', 'network:api.example.com', 'network:*.cdn.example.org'],
        commands: [{ id: 'reset', title: 'Reset' }],
      }),
      'meter',
    );
    expect(problems).toEqual([]);
    expect(manifest).toMatchObject({
      id: 'meter',
      name: 'System meter',
      entry: 'pages/meter.html',
      glyph: '▥',
      permissions: ['system', 'sessions:status'],
      network: ['api.example.com', '*.cdn.example.org'],
      commands: [{ id: 'reset', title: 'Reset' }],
    });
  });

  it('reads an icon path inside the folder, and refuses others', () => {
    expect(parseManifest('{"name":"x","icon":"art/icon.png"}', 'x').manifest?.icon).toBe('art/icon.png');
    for (const bad of ['"../icon.png"', '"/abs.png"', '"icon.gif"', '7']) {
      const { manifest, problems } = parseManifest(`{"name":"x","icon":${bad}}`, 'x');
      expect(manifest?.icon).toBeUndefined();
      expect(problems.join()).toContain('"icon"');
    }
  });

  it('defaults: index.html, no permissions, no network', () => {
    const { manifest } = parseManifest('{"name":"x"}', 'x');
    expect(manifest).toMatchObject({ entry: 'index.html', permissions: [], network: [], commands: [] });
  });

  it('refuses a missing name, bad JSON and a bad folder name', () => {
    expect(parseManifest('{}', 'x').manifest).toBeNull();
    expect(parseManifest('{', 'x').manifest).toBeNull();
    expect(parseManifest('[]', 'x').manifest).toBeNull();
    expect(parseManifest('{"name":"x"}', 'Bad Name').manifest).toBeNull();
    expect(parseManifest('{"name":"x"}', '../up').manifest).toBeNull();
  });

  it('drops unknown permissions and bad domains with a problem line', () => {
    const { manifest, problems } = parseManifest(
      JSON.stringify({
        name: 'x',
        permissions: [
          'system',
          'terminal',
          'network:http://evil.com',
          'network:localhost',
          'network:a.com:8080',
        ],
      }),
      'x',
    );
    expect(manifest?.permissions).toEqual(['system']);
    expect(manifest?.network).toEqual([]);
    expect(problems).toHaveLength(4);
  });

  it('keeps the entry inside the folder', () => {
    for (const entry of ['../x.html', '/etc/x.html', 'a/../../x.html', 'x.js']) {
      const { manifest, problems } = parseManifest(JSON.stringify({ name: 'x', entry }), 'x');
      expect(manifest?.entry).toBe('index.html');
      expect(problems.length).toBe(1);
    }
  });
});

describe('permissions', () => {
  it('allows a method only with its permission', () => {
    expect(methodAllowed('system.get', [])).toBe(false);
    expect(methodAllowed('system.get', ['system'])).toBe(true);
    expect(methodAllowed('sessions.status', ['system'])).toBe(false);
    expect(methodAllowed('storage.set', ['storage'])).toBe(true);
    expect(methodAllowed('notify', ['storage'])).toBe(false);
    // Always there: info, power, chip.
    expect(methodAllowed('chip.set', [])).toBe(true);
    expect(methodAllowed('power.get', [])).toBe(true);
  });

  it('has no method that reads or writes a terminal', () => {
    const all = ['system', 'sessions:status', 'usage', 'storage', 'notify', 'background'] as const;
    for (const m of [
      'session.write',
      'session.output',
      'terminal.read',
      'pty.write',
      'sessions.list',
      'eval',
    ])
      expect(methodAllowed(m, [...all])).toBe(false);
  });

  it('sends events only with their permission', () => {
    expect(eventAllowed('system', [])).toBe(false);
    expect(eventAllowed('system', ['system'])).toBe(true);
    expect(eventAllowed('waiting', ['system'])).toBe(false);
    expect(eventAllowed('waiting', ['sessions:status'])).toBe(true);
    expect(eventAllowed('power', [])).toBe(true);
    expect(eventAllowed('command', [])).toBe(true);
  });
});

describe('network', () => {
  it('without network: only its own files', () => {
    expect(requestAllowed('aquila-ext://meter/index.html', 'meter', [])).toBe(true);
    expect(requestAllowed('aquila-ext://other/index.html', 'meter', [])).toBe(false);
    expect(requestAllowed('https://example.com/', 'meter', [])).toBe(false);
    expect(requestAllowed('http://localhost:3000/', 'meter', [])).toBe(false);
    expect(requestAllowed('file:///etc/passwd', 'meter', [])).toBe(false);
    expect(requestAllowed('data:text/plain,hi', 'meter', [])).toBe(true);
  });

  it('with network: https to the declared domains only', () => {
    const net = ['api.example.com', '*.cdn.org'];
    expect(requestAllowed('https://api.example.com/v1', 'x', net)).toBe(true);
    expect(requestAllowed('wss://api.example.com/live', 'x', net)).toBe(true);
    expect(requestAllowed('http://api.example.com/v1', 'x', net)).toBe(false);
    expect(requestAllowed('https://api.example.com:8443/v1', 'x', net)).toBe(false);
    expect(requestAllowed('https://evil.example.com/', 'x', net)).toBe(false);
    expect(requestAllowed('https://api.example.com.evil.io/', 'x', net)).toBe(false);
    expect(requestAllowed('https://a.cdn.org/x.png', 'x', net)).toBe(true);
    expect(requestAllowed('https://cdn.org/x.png', 'x', net)).toBe(false);
  });

  it('CSP: connect-src none without network', () => {
    const csp = cspFor({ network: [] });
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(cspFor({ network: ['api.example.com'] })).toContain(
      'connect-src https://api.example.com wss://api.example.com',
    );
  });
});

describe('files', () => {
  const root = path.join(os.tmpdir(), 'ext-root', 'meter');
  it('maps its own URLs inside the folder', () => {
    expect(fileFor('aquila-ext://meter/index.html', 'meter', root)).toBe(path.join(root, 'index.html'));
    expect(fileFor('aquila-ext://meter/', 'meter', root)).toBe(path.join(root, 'index.html'));
    expect(fileFor('aquila-ext://meter/a/b.js?x=1', 'meter', root)).toBe(path.join(root, 'a/b.js'));
  });

  it('refuses other extensions and escapes', () => {
    expect(fileFor('aquila-ext://other/index.html', 'meter', root)).toBeNull();
    // The URL parser folds `%2e%2e` back to the root: it never leaves the folder.
    expect(fileFor('aquila-ext://meter/%2e%2e/%2e%2e/secret', 'meter', root)).toBe(path.join(root, 'secret'));
    expect(fileFor('aquila-ext://meter/..%2fsecret', 'meter', root)).toBeNull();
    expect(fileFor('aquila-ext://meter/%00', 'meter', root)).toBeNull();
    expect(safeRelative('a\\b')).toBeNull();
  });
});

describe('feeds', () => {
  it('counts statuses', () => {
    expect(statusCounts(['working', 'waiting', 'waiting', 'idle'])).toEqual({
      working: 1,
      waiting: 2,
      done: 0,
      error: 0,
      idle: 1,
      stopped: 0,
    });
  });

  it('cpu percent between samples', () => {
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50);
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 0 })).toBe(0);
  });

  it('usage as percent', () => {
    const view = usageView([
      {
        account: 'work',
        fiveHour: { used: 50, limit: 200, resetsAt: null },
        weekly: { used: 1, limit: null, resetsAt: null, percent: 12.4 },
        near: false,
      },
    ]);
    expect(view).toEqual([{ account: 'work', kind: 'claude', fiveHour: 25, weekly: 12, near: false }]);
  });
});

describe('prefs, slug, template', () => {
  it('reads prefs defensively', () => {
    expect(parsePrefs('nope')).toEqual({ enabled: {}, background: {}, float: {}, granted: {} });
    expect(parsePrefs('{"enabled":{"a":true,"b":"yes"}}')).toEqual({
      enabled: { a: true },
      background: {},
      float: {},
      granted: {},
    });
    expect(
      parsePrefs('{"granted":{"a":{"permissions":["system",3],"network":["api.x.com"]},"b":"x"}}').granted,
    ).toEqual({ a: { permissions: ['system'], network: ['api.x.com'] } });
  });

  it('a manifest asking for more than was approved is not covered', () => {
    const g = { permissions: ['system'], network: ['api.x.com'] };
    expect(grantCovers(g, { permissions: ['system'], network: [] })).toBe(true);
    expect(grantCovers(g, { permissions: ['system', 'notify'], network: [] })).toBe(false);
    expect(grantCovers(g, { permissions: ['system'], network: ['evil.com'] })).toBe(false);
    expect(grantCovers(undefined, { permissions: [], network: [] })).toBe(false);
  });

  it('names what a manifest added beyond the approval', () => {
    const g = { permissions: ['system'], network: ['api.x.com'] };
    expect(addedBeyond(g, { permissions: ['system', 'notify'], network: ['api.x.com', 'evil.com'] })).toEqual({
      permissions: ['notify'],
      network: ['evil.com'],
    });
  });

  it('slugs a unique folder name', () => {
    expect(slugFor('Pomodoro Timer!', new Set())).toBe('pomodoro-timer');
    expect(slugFor('Pomodoro Timer', new Set(['pomodoro-timer']))).toBe('pomodoro-timer-2');
    expect(slugFor('뽀모도로', new Set())).toBe('extension');
  });

  it('the template is a valid extension', () => {
    const files = templateFiles('my-ext', 'My ext');
    const { manifest, problems } = parseManifest(files['manifest.json'], 'my-ext');
    expect(problems).toEqual([]);
    expect(manifest?.name).toBe('My ext');
    expect(files['index.html']).toContain('aquila.js');
    expect(files['AGENTS.md']).toContain('network:<domain>');
    expect(files['CLAUDE.md']).toBe('@AGENTS.md\n');
  });
});

describe('preload channels', () => {
  it('match the IPC names', () => {
    expect(EXT_REQUEST).toBe(IPC.extensionRequest);
    expect(EXT_EVENT).toBe(IPC.extensionEvent);
    const preload = fs.readFileSync(path.join(__dirname, 'extension-preload.ts'), 'utf8');
    expect(preload).toContain(`'${EXT_REQUEST}'`);
    expect(preload).toContain(`'${EXT_EVENT}'`);
  });
});

describe('floating window', () => {
  it('reads saved window prefs, clamped', () => {
    expect(parseFloatPrefs({ on: true, x: 10, y: 20, width: 50, height: 9999, opacity: 0, onTop: false })).toEqual({
      on: true,
      x: 10,
      y: 20,
      width: FLOAT_MIN.width,
      height: 9999,
      opacity: OPACITY_MIN,
      onTop: false,
    });
    expect(parseFloatPrefs('junk')).toEqual({ on: false, width: 320, height: 240, opacity: 1, onTop: true });
    expect(parseFloatPrefs({ opacity: 3 }).opacity).toBe(1);
    // A spot needs both coordinates.
    expect(parseFloatPrefs({ x: 10 }).x).toBeUndefined();
  });

  it('keeps float prefs in the prefs file', () => {
    const p = parsePrefs('{"float":{"meter":{"on":true,"width":400,"height":300,"opacity":0.7}}}');
    expect(p.float.meter).toMatchObject({ on: true, width: 400, height: 300, opacity: 0.7, onTop: true });
  });

  it('opens where it was when that is still on a display', () => {
    const displays = [{ x: 0, y: 0, width: 1440, height: 900 }];
    const app = { x: 100, y: 50, width: 1200, height: 800 };
    expect(placeFloat({ x: 900, y: 100, width: 320, height: 240 }, app, displays)).toEqual({
      x: 900,
      y: 100,
      width: 320,
      height: 240,
    });
    // The second monitor is gone: next to the app window's top-right instead.
    expect(placeFloat({ x: 3000, y: 100, width: 320, height: 240 }, app, displays)).toEqual({
      x: 100 + 1200 - 320 - 24,
      y: 50 + 64,
      width: 320,
      height: 240,
    });
    // Never placed: same.
    expect(placeFloat({ width: 320, height: 240 }, app, displays).x).toBe(956);
    // No app window: the first display's top-right.
    expect(placeFloat({ width: 320, height: 240 }, null, displays)).toEqual({ x: 1096, y: 64, width: 320, height: 240 });
  });
});
