import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyDir } from './config';

const tmp: string[] = [];
const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-test-'));
  tmp.push(d);
  return d;
};
afterEach(() => tmp.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe('migrateLegacyDir', () => {
  it('copies the old config and state, skipping the hook settings', () => {
    const from = dir();
    const to = path.join(dir(), '.aquila');
    fs.writeFileSync(path.join(from, 'config.json'), '{"language":"en"}');
    fs.writeFileSync(path.join(from, 'state.json'), '{}');
    fs.writeFileSync(path.join(from, 'claude-hooks.json'), '{}');

    expect(migrateLegacyDir(from, to)).toBe(true);
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('{"language":"en"}');
    expect(fs.existsSync(path.join(to, 'state.json'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'claude-hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(from, 'config.json'))).toBe(true);
  });

  it('does nothing when the new config exists or there is no old one', () => {
    const from = dir();
    const to = dir();
    fs.writeFileSync(path.join(from, 'config.json'), '{"language":"en"}');
    fs.writeFileSync(path.join(to, 'config.json'), '{"language":"ko"}');
    expect(migrateLegacyDir(from, to)).toBe(false);
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('{"language":"ko"}');
    expect(migrateLegacyDir(dir(), path.join(dir(), 'x'))).toBe(false);
  });
});
