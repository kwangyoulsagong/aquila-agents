import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8');

describe('design tokens', () => {
  const tokens = read('tokens.css');
  const components = read('components.css');
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

  it('every semantic token components.css uses is defined in tokens.css', () => {
    const used = new Set(
      [...components.matchAll(/var\(\s*(--(?:color|font|space|radius|size|motion)-[\w-]+)/g)].map(
        (m) => m[1],
      ),
    );
    expect([...used].filter((t) => !defined.has(t))).toEqual([]);
  });

  it('underline offsets come from tokens, never raw px', () => {
    expect(components).not.toMatch(/text-underline-offset:\s*\d+px/);
    expect(defined.has('--size-underline-offset')).toBe(true);
  });
});
