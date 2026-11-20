import { describe, expect, it } from 'vitest';
import {
  cropRect,
  DevUrlTracker,
  findDevUrls,
  fitView,
  mergeTargets,
  normalizeUrl,
  parseLaunchJson,
} from './preview';

describe('parseLaunchJson', () => {
  it('reads port and url entries', () => {
    const text = JSON.stringify({
      version: '0.0.1',
      configurations: [
        { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 5173 },
        { name: 'api', url: 'http://127.0.0.1:8080/docs' },
        { name: 'dup', port: 5173 },
        { name: 'bad', port: 'x' },
        null,
      ],
    });
    expect(parseLaunchJson(text)).toEqual(['http://localhost:5173/', 'http://localhost:8080/docs']);
  });

  it('is empty on anything unexpected', () => {
    expect(parseLaunchJson('not json')).toEqual([]);
    expect(parseLaunchJson('null')).toEqual([]);
    expect(parseLaunchJson('{"configurations": {}}')).toEqual([]);
    expect(parseLaunchJson('{"configurations": [{"port": 70000}]}')).toEqual([]);
  });
});

describe('findDevUrls', () => {
  it('finds a Vite address with the port in bold', () => {
    const out =
      '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\r\n';
    expect(findDevUrls(out)).toEqual(['http://localhost:5173/']);
  });

  it('normalizes hosts and keeps paths', () => {
    expect(findDevUrls('ready on http://0.0.0.0:3000, and http://127.0.0.1:4000/app.')).toEqual([
      'http://localhost:3000/',
      'http://localhost:4000/app',
    ]);
    expect(findDevUrls('http://[::1]:8000')).toEqual(['http://localhost:8000/']);
  });

  it('ignores request logs and API calls (deep paths)', () => {
    const log = 'GET http://localhost:18080/api/home/today 200\nready on http://localhost:3100/app/\n';
    expect(findDevUrls(log)).toEqual(['http://localhost:3100/app/']);
  });

  it('ignores remote hosts, no port and ignored ports', () => {
    expect(findDevUrls('https://example.com:443 http://localhost/ http://localhost:7777')).toEqual([
      'http://localhost:7777/',
    ]);
    expect(findDevUrls('http://127.0.0.1:7777/hook', [7777])).toEqual([]);
  });
});

describe('normalizeUrl', () => {
  it('drops trailing punctuation', () => {
    expect(normalizeUrl('http://localhost:3000/;')).toBe('http://localhost:3000/');
  });
});

describe('DevUrlTracker', () => {
  it('joins chunks, keeps the latest first and reports changes only', () => {
    const changes: string[][] = [];
    const t = new DevUrlTracker((_p, urls) => changes.push(urls));
    t.feed('p', 's1', 'Local: http://local');
    t.feed('p', 's1', 'host:5173/\n');
    t.feed('p', 's1', 'again http://localhost:5173/\n');
    t.feed('p', 's2', 'next http://localhost:3000\n');
    t.feed('p', 's2', 'yyyyyyyyyyyyy\n'.repeat(100));
    expect(changes).toEqual([
      ['http://localhost:5173/'],
      ['http://localhost:3000/', 'http://localhost:5173/'],
    ]);
    expect(t.urls('p')).toEqual(['http://localhost:3000/', 'http://localhost:5173/']);
    expect(t.urls('other')).toEqual([]);
  });
});

describe('mergeTargets', () => {
  it('puts launch.json first without duplicates', () => {
    expect(mergeTargets(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('fitView', () => {
  const stage = { x: 100, y: 40, width: 600, height: 800 };
  it('fills the stage when there is no preset', () => {
    expect(fitView(stage, 0)).toEqual({ bounds: stage, zoom: 1 });
  });
  it('centres a narrower preset at 1×', () => {
    expect(fitView(stage, 390)).toEqual({ bounds: { x: 205, y: 40, width: 390, height: 800 }, zoom: 1 });
  });
  it('zooms out a wider preset', () => {
    const { bounds, zoom } = fitView(stage, 1440);
    expect(bounds).toEqual(stage);
    expect(zoom).toBeCloseTo(600 / 1440);
  });
});

describe('cropRect', () => {
  it('adds a margin, scales and clamps', () => {
    expect(cropRect({ x: 10, y: 20, width: 100, height: 50 }, 0.5, { width: 400, height: 300 })).toEqual({
      x: 1,
      y: 6,
      width: 58,
      height: 33,
    });
    expect(cropRect({ x: 0, y: 0, width: 1000, height: 1000 }, 1, { width: 400, height: 300 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });
  it('is null for an empty rect', () => {
    expect(cropRect({ x: 500, y: 500, width: 10, height: 10 }, 1, { width: 400, height: 300 })).toBeNull();
  });
});
