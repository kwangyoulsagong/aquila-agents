// Claude Code reports status through hooks. We pass `--settings ~/.aquila/claude-hooks.json`
// only to sessions we spawn, so normal terminal Claude is untouched. Hooks are local shell commands: no tokens.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { APP_DIR } from './config';
import { isSessionId } from './state';
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

/** SessionStart gets `{ session_id, ... }` on stdin; forward it so restore resumes the right session after /clear. */
const SESSION_START_COMMAND =
  '[ -n "$AQUILA_PORT" ] && curl -s -m 1 -X POST -H "Content-Type: application/json" --data-binary @- ' +
  '"http://127.0.0.1:$AQUILA_PORT/session/$AQUILA_TAB_ID" -o /dev/null; true';

const MAX_BODY = 64 * 1024;

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
  hooks.SessionStart = [{ hooks: [{ type: 'command', command: SESSION_START_COMMAND }] }];
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.writeFileSync(HOOK_SETTINGS_PATH, JSON.stringify({ hooks }, null, 2));
  return HOOK_SETTINGS_PATH;
}

export function startHookServer(
  onHook: (tabId: string, status: HookStatus) => void,
  onClaudeSession: (tabId: string, claudeSessionId: string) => void = () => {},
): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const start = req.method === 'POST' ? /^\/session\/([\w-]+)$/.exec(req.url ?? '') : null;
      if (start) {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_BODY) req.destroy();
        });
        req.on('end', () => {
          try {
            const id = (JSON.parse(body) as { session_id?: unknown }).session_id;
            if (isSessionId(id)) onClaudeSession(start[1], id);
          } catch {
            // not JSON: ignore
          }
          res.writeHead(204).end();
        });
        return;
      }
      const m =
        req.method === 'POST' ? /^\/hook\/([\w-]+)\/(working|waiting|done)$/.exec(req.url ?? '') : null;
      req.resume();
      if (m) onHook(m[1], m[2] as HookStatus);
      res.writeHead(m ? 204 : 404).end();
    });
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}
