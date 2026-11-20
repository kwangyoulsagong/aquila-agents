// Global shortcut (T41): one system-wide key that brings the window up and focuses the next waiting session.
// Off until the user records a key; the key lives in ~/.aquila/global-shortcut.json. Registered only while one is
// set, unregistered on quit. Smoke never reads or writes it.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './config';
import type { GlobalShortcutState } from '../src/shared/api/types';

export const GLOBAL_SHORTCUT_PATH = path.join(APP_DIR, 'global-shortcut.json');

const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'Alt',
  'Option',
  'Shift',
  'CommandOrControl',
]);
/** Modifiers that make a key safe to take system-wide (Shift alone would steal capital letters everywhere). */
const STRONG = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'Alt', 'Option', 'CommandOrControl']);
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Up|Down|Left|Right|Space|[`\-=[\]\\;',./])$/;

/** An accelerator we accept: known modifiers (one that isn't Shift) + exactly one key, no repeats. */
export function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  if (!KEY.test(key) || new Set(parts).size !== parts.length) return false;
  return parts.every((m) => MODIFIERS.has(m)) && parts.some((m) => STRONG.has(m));
}

/** Defensive parse: anything unexpected means "off", never a throw. */
export function parseGlobalShortcut(text: string): string | null {
  try {
    const raw: unknown = JSON.parse(text);
    const acc = raw && typeof raw === 'object' ? (raw as { accelerator?: unknown }).accelerator : null;
    return isValidAccelerator(acc) ? acc : null;
  } catch {
    return null;
  }
}

export function readGlobalShortcut(file = GLOBAL_SHORTCUT_PATH): string | null {
  try {
    return parseGlobalShortcut(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Temp file + rename, so a crash never leaves half a file. */
export function writeGlobalShortcut(accelerator: string | null, file = GLOBAL_SHORTCUT_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ accelerator }, null, 2));
  fs.renameSync(tmp, file);
}

/** The part of Electron's `globalShortcut` we use (injected so tests run without Electron). */
export interface Registrar {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/**
 * Owns the one registration. `set` saves a key only once the OS gave it to us: a taken key reports `taken` and the
 * previous key stays saved and registered.
 */
export class GlobalShortcut {
  private saved: string | null = null;
  private active = false;

  constructor(
    private readonly registrar: Registrar,
    private readonly onFire: () => void,
    private readonly store: { read: () => string | null; write: (a: string | null) => void },
  ) {}

  /** At launch: register the saved key, if any. A key taken since then is reported, not dropped. */
  start(): GlobalShortcutState {
    this.saved = this.store.read();
    if (!this.saved) return this.state();
    this.active = this.tryRegister(this.saved) === 'ok';
    return this.current();
  }

  /** What the settings dialog shows when it opens: a saved key the OS didn't give us counts as taken. */
  current(): GlobalShortcutState {
    return this.saved && !this.active ? this.state('taken') : this.state();
  }

  state(error?: GlobalShortcutState['error'], failed?: string): GlobalShortcutState {
    return {
      accelerator: this.saved,
      active: this.active,
      ...(error && { error }),
      ...(failed && { failed }),
    };
  }

  /** New key (null = off). */
  set(accelerator: string | null): GlobalShortcutState {
    if (accelerator === null) {
      this.release();
      this.saved = null;
      this.store.write(null);
      return this.state();
    }
    if (!isValidAccelerator(accelerator)) return this.state('invalid', accelerator);
    if (accelerator === this.saved && this.active) return this.state();
    const previous = this.saved;
    this.release();
    const result = this.tryRegister(accelerator);
    if (result !== 'ok') {
      // Put the old key back so a failed change never leaves the user with nothing.
      if (previous) this.active = this.tryRegister(previous) === 'ok';
      return this.state(result, accelerator);
    }
    this.active = true;
    this.saved = accelerator;
    this.store.write(accelerator);
    return this.state();
  }

  /** On quit. */
  dispose(): void {
    this.release();
  }

  private release(): void {
    if (this.saved && this.active) this.registrar.unregister(this.saved);
    this.active = false;
  }

  private tryRegister(accelerator: string): 'ok' | 'taken' | 'invalid' {
    try {
      return this.registrar.register(accelerator, this.onFire) ? 'ok' : 'taken';
    } catch {
      // Electron throws on an accelerator it can't parse.
      return 'invalid';
    }
  }
}
