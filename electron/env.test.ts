import { describe, expect, it } from 'vitest';
import { mergePath, parseShellPath } from './env';

describe('parseShellPath', () => {
  it('finds the PATH between markers despite rc-file noise', () => {
    const out = 'Welcome!\n__AQUILA_PATH__/opt/homebrew/bin:/usr/bin__AQUILA_PATH__\nbye';
    expect(parseShellPath(out)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('returns null when the markers are missing or the value is empty', () => {
    expect(parseShellPath('no markers here')).toBeNull();
    expect(parseShellPath('__AQUILA_PATH____AQUILA_PATH__')).toBeNull();
  });
});

describe('mergePath', () => {
  it('puts the shell PATH first and drops duplicates', () => {
    expect(mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin')).toBe('/opt/homebrew/bin:/usr/bin:/bin');
    expect(mergePath('/a', undefined)).toBe('/a');
  });
});
