// `npm run smoke`: launch the built app, open a shell session, check the pty round-trips,
// save a screenshot to dist/smoke.png, then quit with exit code 0 (ok) or 1 (fail).
// Agents use this to verify their change actually runs.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { SessionManager } from './sessions';
import type { Config } from '../src/shared/api/types';

const MARKER = 'AGENTRIX_SMOKE_OK';
const TIMEOUT_MS = 20000;

export const isSmoke = process.env.AGENTRIX_SMOKE === '1';

/** Wrap the session `send` so smoke can watch pty output. */
export function watchOutput(send: (ch: string, p: unknown) => void, onData: (data: string) => void) {
  return (channel: string, payload: unknown) => {
    if (channel === 'session:data') onData((payload as { data: string }).data);
    send(channel, payload);
  };
}

export async function runSmoke(
  win: BrowserWindow,
  sessions: SessionManager,
  config: Config,
  output: { buffer: string },
) {
  const fail = (why: string) => {
    console.error(`[smoke] FAIL: ${why}`);
    app.exit(1);
  };
  const timer = setTimeout(() => fail('timeout'), TIMEOUT_MS);

  const project = config.projects[0];
  if (!project) return fail('no project in config');

  await new Promise((r) => setTimeout(r, 1500)); // let the renderer paint
  const { id } = sessions.create(config, project.id, 'shell');
  setTimeout(() => sessions.write(id, `echo ${MARKER}\r`), 1500);

  const poll = setInterval(async () => {
    if (!output.buffer.includes(MARKER)) return;
    clearInterval(poll);
    clearTimeout(timer);
    const out = path.join(__dirname, '..', '..', 'dist', 'smoke.png');
    fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
    console.log(`[smoke] OK — pty round-trip works, screenshot: ${out}`);
    sessions.killAll();
    app.exit(0);
  }, 200);
}
