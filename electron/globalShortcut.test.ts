import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GlobalShortcut,
  isValidAccelerator,
  parseGlobalShortcut,
  readGlobalShortcut,
  writeGlobalShortcut,
  type Registrar,
} from './globalShortcut';

describe('isValidAccelerator', () => {
  it('needs a modifier other than Shift and one known key', () => {
    expect(isValidAccelerator('Command+Shift+J')).toBe(true);
    expect(isValidAccelerator('Control+Alt+Space')).toBe(true);
    expect(isValidAccelerator('Alt+F5')).toBe(true);
    expect(isValidAccelerator('Command+/')).toBe(true);
    expect(isValidAccelerator('Shift+J')).toBe(false);
    expect(isValidAccelerator('J')).toBe(false);
    expect(isValidAccelerator('Command+Shift')).toBe(false);
    expect(isValidAccelerator('Command+Command+J')).toBe(false);
    expect(isValidAccelerator('Hyper+J')).toBe(false);
    expect(isValidAccelerator('Command+JJ')).toBe(false);
    expect(isValidAccelerator(42)).toBe(false);
  });
});

describe('stored key', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-gs-'));
    file = path.join(dir, 'sub', 'global-shortcut.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('parses defensively', () => {
    expect(parseGlobalShortcut('{"accelerator":"Command+J"}')).toBe('Command+J');
    expect(parseGlobalShortcut('{"accelerator":"J"}')).toBeNull();
    expect(parseGlobalShortcut('null')).toBeNull();
    expect(parseGlobalShortcut('{oops')).toBeNull();
  });

  it('is off without a file and round-trips', () => {
    expect(readGlobalShortcut(file)).toBeNull();
    writeGlobalShortcut('Control+Alt+J', file);
    expect(readGlobalShortcut(file)).toBe('Control+Alt+J');
    writeGlobalShortcut(null, file);
    expect(readGlobalShortcut(file)).toBeNull();
    expect(fs.readdirSync(path.dirname(file))).toEqual(['global-shortcut.json']);
  });
});

describe('GlobalShortcut', () => {
  const setup = (saved: string | null, taken: string[] = []) => {
    const registered = new Set<string>();
    const registrar: Registrar = {
      register: (a) => {
        if (a === 'Command+Bad') throw new Error('parse');
        if (taken.includes(a)) return false;
        registered.add(a);
        return true;
      },
      unregister: (a) => void registered.delete(a),
    };
    const store = { value: saved, read: () => store.value, write: (a: string | null) => (store.value = a) };
    const fire = vi.fn();
    return { gs: new GlobalShortcut(registrar, fire, store), registered, store, fire };
  };

  it('registers nothing while off', () => {
    const { gs, registered } = setup(null);
    expect(gs.start()).toEqual({ accelerator: null, active: false });
    expect(registered.size).toBe(0);
  });

  it('registers the saved key at launch and reports it when taken', () => {
    expect(setup('Command+J').gs.start()).toEqual({ accelerator: 'Command+J', active: true });
    expect(setup('Command+J', ['Command+J']).gs.start()).toEqual({
      accelerator: 'Command+J',
      active: false,
      error: 'taken',
    });
  });

  it('swaps keys and turns off', () => {
    const { gs, registered, store } = setup('Command+J');
    gs.start();
    expect(gs.set('Control+Alt+K')).toEqual({ accelerator: 'Control+Alt+K', active: true });
    expect([...registered]).toEqual(['Control+Alt+K']);
    expect(store.value).toBe('Control+Alt+K');
    expect(gs.set(null)).toEqual({ accelerator: null, active: false });
    expect(registered.size).toBe(0);
    expect(store.value).toBeNull();
  });

  it('keeps the old key when the new one is taken or invalid', () => {
    const { gs, registered, store } = setup('Command+J', ['Command+Space']);
    gs.start();
    expect(gs.set('Command+Space')).toEqual({
      accelerator: 'Command+J',
      active: true,
      error: 'taken',
      failed: 'Command+Space',
    });
    expect(gs.set('Command+Bad')).toMatchObject({ accelerator: 'Command+J', error: 'invalid' });
    expect(gs.set('J')).toMatchObject({ accelerator: 'Command+J', error: 'invalid', failed: 'J' });
    expect([...registered]).toEqual(['Command+J']);
    expect(store.value).toBe('Command+J');
  });

  it('reports a saved key the OS refused as taken when asked again', () => {
    const { gs } = setup('Command+J', ['Command+J']);
    gs.start();
    expect(gs.current()).toEqual({ accelerator: 'Command+J', active: false, error: 'taken' });
  });

  it('unregisters on dispose', () => {
    const { gs, registered } = setup('Command+J');
    gs.start();
    gs.dispose();
    expect(registered.size).toBe(0);
  });
});
