// Test helper (T36): a fake `ssh host -- script` that runs the script with this machine's `sh`, HOME set to a temp
// "remote home", so the real remote scripts (quoting, stat/find/gzip, sections) are exercised without a host.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RemoteExec } from './exec';

export interface FakeHost {
  home: string;
  exec: RemoteExec;
  /** Scripts run so far. */
  scripts: string[];
  /** Make the next calls fail like an unreachable host (ssh exit 255). */
  down: boolean;
  dispose(): void;
}

export function fakeHost(): FakeHost {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-rhome-'));
  const host: FakeHost = {
    home,
    scripts: [],
    down: false,
    exec: async (_host, script, opts = {}) => {
      host.scripts.push(script);
      if (host.down)
        return {
          code: 255,
          stdout: Buffer.alloc(0),
          stderr: 'ssh: connect to host devbox port 22: Connection refused\n',
          ms: 1,
        };
      const started = Date.now();
      const r = spawnSync('sh', ['-c', script], {
        input: opts.input ?? '',
        env: { ...process.env, HOME: home, CODEX_HOME: '' },
        maxBuffer: 256 * 1024 * 1024,
      });
      // A login shell's noise before our output must not matter.
      const noise = Buffer.from('Welcome to devbox\n');
      return {
        code: r.status ?? 1,
        stdout: Buffer.concat([noise, r.stdout]),
        stderr: String(r.stderr),
        ms: Date.now() - started,
      };
    },
    dispose: () => fs.rmSync(home, { recursive: true, force: true }),
  };
  return host;
}
