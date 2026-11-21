// One command on an SSH host, over the shared master connection (T36). Used by the remote changes panel and history.
// BatchMode: never prompts; a host that needs a password works once a tab's interactive ssh has opened the master.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RemoteHost } from '../../src/shared/api/types';
import { inLoginShell, MUX_OPTIONS, shq, SSH_FAILED, SSH_OPTIONS, validAlias } from './ssh';
import { sshError } from './check';

export interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
  /** Wall time of the round trip (latency, logged per host). */
  ms: number;
}

export interface ExecOptions {
  /** Sent on stdin (file lists, patches). */
  input?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Runs a POSIX sh script on the host and resolves with its output (never rejects on a non-zero exit). */
export type RemoteExec = (host: RemoteHost, script: string, opts?: ExecOptions) => Promise<ExecResult>;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

/** ssh's ControlPath dir must exist before the first connection, or ssh exits 255 instead of connecting. */
export function ensureControlDir(home = os.homedir()): void {
  try {
    fs.mkdirSync(path.join(home, '.aquila', 'ssh'), { recursive: true, mode: 0o700 });
  } catch {
    // ssh reports it on the first connection
  }
}

/**
 * argv: login shell (PATH from ~/.profile, like sessions) → `sh -c` so scripts are POSIX whatever the user's shell is.
 */
export function execArgs(alias: string, script: string): string[] {
  if (!validAlias(alias)) throw new Error(`Invalid SSH host: ${alias}`);
  return [
    '-o',
    'BatchMode=yes',
    ...SSH_OPTIONS,
    ...MUX_OPTIONS,
    alias,
    '--',
    inLoginShell(`exec sh -c ${shq(script)}`),
  ];
}

/** Last round trip per host (ms), for the panels and the log. */
export const latency = new Map<string, number>();

export const sshExec: RemoteExec = (host, script, opts = {}) => {
  ensureControlDir();
  const args = execArgs(host.alias, script);
  const started = Date.now();
  return new Promise((resolve) => {
    const p = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let done = false;
    const finish = (code: number, extra = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ms = Date.now() - started;
      latency.set(host.alias, ms);
      resolve({ code, stdout: Buffer.concat(out), stderr: stderr + extra, ms });
    };
    const timer = setTimeout(() => {
      p.kill();
      finish(SSH_FAILED, 'Timed out');
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    p.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > (opts.maxBytes ?? DEFAULT_MAX_BYTES)) {
        p.kill();
        finish(1, 'Output too large');
        return;
      }
      out.push(d);
    });
    p.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    p.on('error', (e) => finish(SSH_FAILED, e.message));
    p.on('close', (code) => finish(code ?? 1));
    p.stdin.on('error', () => undefined);
    p.stdin.end(opts.input ?? '');
  });
};

/** A failed round trip as one line: ssh's own error for exit 255, else the script's last stderr line. */
export function execError(r: ExecResult, fallback: string): string {
  return sshError(r.stderr, fallback);
}

/** A random boundary for splitting a script's output into named sections (no chance of appearing in a diff). */
export const boundary = (): string =>
  `AQUILA-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** Shell line that starts a section: `\n<boundary> <name>\n`. */
export const sectionLine = (b: string, name: string): string => `printf '\\n%s %s\\n' '${b}' '${name}'`;

/**
 * Splits output written with `sectionLine` into name → text. Anything before the first boundary (a login shell's
 * MOTD, rc file noise) is dropped.
 */
export function parseSections(out: string, b: string): Map<string, string> {
  const parts = out.split(`\n${b} `);
  const map = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    if (nl < 0) map.set(part, '');
    else map.set(part.slice(0, nl), part.slice(nl + 1));
  }
  return map;
}
