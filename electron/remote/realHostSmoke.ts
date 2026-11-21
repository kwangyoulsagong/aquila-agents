// Opt-in smoke step: the remote flow against a real SSH host (T29/T36 leftover "remote check on a real host").
//   scripts/ssh-test-host/up.sh            → a Docker host + ssh_config with `Host aquila-test`
//   AQUILA_SMOKE_SSH_HOST=aquila-test AQUILA_SMOKE_SSH_CONFIG=<dir>/ssh_config npm run smoke
// AQUILA_SMOKE_SSH_CONFIG is optional: with it, an `ssh` wrapper that adds `-F <file>` goes first on PATH for this
// step only, so ~/.ssh is never touched. AQUILA_SMOKE_SSH_DROP is the shell command that cuts the link from the host
// side (default: kill the user's sshd processes in the `aquila-ssh-test` container).
// The project is `/work/app` on the host (a git repo; up.sh makes it). Changes are made by typing in the tab and are
// reverted through the Changes actions; the only other writes are ours (~/.aquila/tmux.conf, ~/.aquila/trash).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionManager } from '../sessions';
import type { Config, ConnectionUpdate, RemoteHost } from '../../src/shared/api/types';
import { HistoryIndex } from '../history';
import { gitAction } from '../git';
import { checkRemote } from './check';
import { sshExec } from './exec';
import { remoteGit, remoteGitChanges, remoteTrash } from './git';
import { STABLE_MS } from './reconnect';
import { tmuxSession, TMUX_SOCKET } from './ssh';

const DIR = '/work/app';
const DEFAULT_DROP = `docker exec aquila-ssh-test pkill -f 'sshd: dev'`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function checkRealHost(
  sessions: SessionManager,
  config: Config,
  output: { buffer: string; connections: ConnectionUpdate[] },
): Promise<string | null> {
  const alias = process.env.AQUILA_SMOKE_SSH_HOST;
  if (!alias) {
    console.log('[smoke] real ssh host: skipped (AQUILA_SMOKE_SSH_HOST, see scripts/ssh-test-host/up.sh)');
    return null;
  }
  const cfg = process.env.AQUILA_SMOKE_SSH_CONFIG;
  const oldPath = process.env.PATH;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-smoke-realssh-'));
  if (cfg) {
    const ssh = execSync('command -v ssh', { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nexec ${ssh} -F '${cfg}' "$@"\n`, { mode: 0o755 });
    process.env.PATH = `${bin}:${oldPath ?? ''}`;
  }
  const host: RemoteHost = { alias };
  const project = {
    id: 'smoke-real-remote',
    name: 'smoke-real-remote',
    group: 'remote',
    account: 'shared',
    path: DIR,
    remote: host,
  };
  const remoteConfig: Config = { ...config, projects: [...config.projects, project] };
  const states = (id: string) => output.connections.filter((c) => c.id === id).map((c) => c.state);
  const until = async (what: string, ok: () => boolean | Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > end) throw new Error(`real ssh host: ${what}`);
      await wait(150);
    }
  };
  const log: string[] = [];
  let id: string | null = null;
  try {
    // 1. Check host (the add-project dialog's probe).
    const check = await checkRemote(host);
    if (!check.reachable) return `real ssh host: check failed: ${check.error ?? 'unreachable'}`;
    const tool = (t: string) => check.tools.find((x) => x.tool === t);
    if (!tool('tmux')?.path || !tool('git')?.path)
      return `real ssh host: check found no tmux/git: ${JSON.stringify(check.tools)}`;
    log.push(`check ${check.system} tmux ${tool('tmux')?.version ?? '?'} git ${tool('git')?.version ?? '?'}`);

    // 2. A shell tab over ssh + tmux.
    const s = sessions.create(remoteConfig, project.id, 'shell');
    id = s.id;
    const sid = s.id;
    const key = sessions.tabs().find((t) => t.projectId === project.id)?.key ?? '';
    const connected = () => states(sid).filter((x) => x === 'connected').length;
    await until('tab never connected', () => connected() >= 1, 15_000);
    sessions.write(sid, `cd ${DIR} && export AQ_MARK=$((30+7)); echo AQUILA_REAL_$((40+1))\r`);
    await until('no output through ssh', () => output.buffer.includes('AQUILA_REAL_41'), 8000);
    log.push('tab connected');

    // 3. Changes: edit a tracked file and add one by typing in the tab, then read them like the panel does.
    sessions.write(
      sid,
      `printf 'export const b = 2;\\n' >> a.ts; printf 'new\\n' > b.ts; echo AQUILA_REAL_$((40+2))\r`,
    );
    await until('edits did not run', () => output.buffer.includes('AQUILA_REAL_42'), 8000);
    const changes = await remoteGitChanges(sshExec, host, DIR);
    const letters = changes.files.map((f) => `${f.status} ${f.path}`).sort();
    if (
      !changes.isRepo ||
      letters.join(',') !== '? b.ts,M a.ts' ||
      !changes.diff.includes('+export const b = 2;')
    )
      return `real ssh host: changes ${JSON.stringify({ isRepo: changes.isRepo, letters, branch: changes.branch })}`;
    log.push(`changes ${letters.join(', ')} on ${changes.branch} (${changes.latencyMs ?? '?'} ms)`);
    // Revert both through the panel's actions: the tracked edit goes to a stash, the new file to ~/.aquila/trash.
    const run = remoteGit(sshExec, host, DIR);
    const trash = remoteTrash(sshExec, host, DIR);
    const r1 = await gitAction(run, { action: 'revert-file', path: 'a.ts' }, trash);
    const r2 = await gitAction(run, { action: 'revert-file', path: 'b.ts' }, trash);
    const after = await remoteGitChanges(sshExec, host, DIR);
    if (after.files.length) return `real ssh host: revert left ${JSON.stringify(after.files)}`;
    log.push(`reverted (stash ${r1.stash?.slice(0, 7) ?? '-'}, trashed to ${r2.trashedTo ?? '-'})`);

    // 4. History: the host's transcripts, matched to the remote project.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-smoke-realhist-'));
    const history = await new HistoryIndex(
      { codexHome: path.join(tmp, 'codex'), metaFile: path.join(tmp, 'meta.json') },
      sshExec,
    ).refreshRemote(remoteConfig);
    fs.rmSync(tmp, { recursive: true, force: true });
    const hostState = history.hosts?.find((h) => h.alias === alias);
    if (!hostState || hostState.error) return `real ssh host: history ${hostState?.error ?? 'no host entry'}`;
    const mine = history.entries.filter((e) => e.host === alias);
    if (!mine.some((e) => e.projectId === project.id))
      return `real ssh host: history has ${mine.length} entries, none matched ${DIR}`;
    log.push(
      `history ${mine.length} entries (${mine.filter((e) => e.projectId === project.id).length} for ${DIR})`,
    );

    // 5. Drop the link from the host side: reconnect and reattach to the same tmux session (the shell var is there).
    const before = connected();
    execSync(process.env.AQUILA_SMOKE_SSH_DROP ?? DEFAULT_DROP, { stdio: 'ignore' });
    await until('no reconnect after the link dropped', () => connected() > before, 3000 + STABLE_MS + 15_000);
    sessions.write(sid, 'echo AQUILA_REAL_$AQ_MARK\r');
    await until(
      'reconnected to a different shell (tmux not reattached)',
      () => output.buffer.includes('AQUILA_REAL_37'),
      8000,
    );
    log.push(`reconnected: ${states(sid).join(' → ')}`);

    // 6. Closing the tab kills its tmux session on the host.
    sessions.kill(sid);
    id = null;
    const name = tmuxSession(key);
    await until(
      `closing the tab left ${name} running`,
      async () => {
        const r = await sshExec(host, `tmux -L ${TMUX_SOCKET} ls 2>/dev/null || true`);
        return r.code === 0 && !r.stdout.includes(name);
      },
      10_000,
    );
    log.push(`closed: ${name} gone`);
    console.log(`[smoke] real ssh host ${alias}: ${log.join('; ')}`);
    return null;
  } catch (err) {
    console.log(`[smoke] real ssh host ${alias} so far: ${log.join('; ')}`);
    return (err as Error).message;
  } finally {
    if (id) sessions.kill(id);
    process.env.PATH = oldPath;
    setTimeout(() => fs.rmSync(bin, { recursive: true, force: true }), 5000);
  }
}
