// Claude Code reports status through hooks. We pass `--settings ~/.aquila/claude-hooks.json`
// only to sessions we spawn, so normal terminal Claude is untouched. Hooks are local shell commands: no tokens.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { APP_DIR } from './config';
import type { HookStatus } from '../src/shared/api/types';

const HOOK_SETTINGS_PATH = path.join(APP_DIR, 'claude-hooks.json');

const EVENTS: Record<string, HookStatus> = {
  UserPromptSubmit: 'working',
  PostToolUse: 'working',
  Notification: 'waiting',
  Stop: 'done',
};

const hookCommand = (status: HookStatus) =>
  `[ -n "$AQUILA_PORT" ] && curl -s -m 1 -X POST "http://127.0.0.1:$AQUILA_PORT/hook/$AQUILA_TAB_ID/${status}" -o /dev/null; true`;

export function writeClaudeHookSettings(): string {
  const hooks: Record<string, unknown[]> = {};
  for (const [event, status] of Object.entries(EVENTS)) {
    hooks[event] = [
      {
        ...(event === 'PostToolUse' ? { matcher: '*' } : {}),
        hooks: [{ type: 'command', command: hookCommand(status) }],
      },
    ];
  }
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.writeFileSync(HOOK_SETTINGS_PATH, JSON.stringify({ hooks }, null, 2));
  return HOOK_SETTINGS_PATH;
}

export function startHookServer(onHook: (tabId: string, status: HookStatus) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const m =
        req.method === 'POST' ? /^\/hook\/([\w-]+)\/(working|waiting|done)$/.exec(req.url ?? '') : null;
      req.resume();
      if (m) onHook(m[1], m[2] as HookStatus);
      res.writeHead(m ? 204 : 404).end();
    });
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}
