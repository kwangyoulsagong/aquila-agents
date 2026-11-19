import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markGuideOffered, parseGuideState, readGuideState } from './guide';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-guide-'));
  file = path.join(dir, 'sub', 'guide.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('guide state', () => {
  it('parses defensively', () => {
    expect(parseGuideState('{"offered":true}')).toEqual({ offered: true });
    expect(parseGuideState('{"offered":"yes"}')).toEqual({ offered: false });
    expect(parseGuideState('null')).toEqual({ offered: false });
    expect(parseGuideState('{oops')).toEqual({ offered: false });
  });

  it('is not offered without a file, and offered once marked', () => {
    expect(readGuideState(file)).toEqual({ offered: false });
    markGuideOffered(file);
    expect(readGuideState(file)).toEqual({ offered: true });
    expect(fs.readdirSync(path.dirname(file))).toEqual(['guide.json']);
  });
});
