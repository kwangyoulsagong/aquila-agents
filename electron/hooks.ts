// Claude Code hooks: notification context and the status fallback for Claude versions without OSC 7501.
// We pass `--settings ~/.aquila/claude-hooks*.json` only to sessions we spawn, so normal terminal Claude is untouched.
// Claude posts each event's JSON to our local receiver (`type: "http"`, no shell, no curl per event);
// Claude older than HTTP_HOOKS_SINCE (and SessionStart, which can't be http) gets the same POST through a
// command + curl. No tokens either way.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { APP_DIR } from './config';
import { statusLineSettings } from './context';
import { firstLine, toolSummary } from './notify';
import { isSessionId } from './state';
import { WAITING_NOTIFICATIONS, type HookSignal } from './status/tracker';

/**
 * The http settings bake in this instance's receiver port, so each instance writes its own pair
 * (`claude-hooks.<port>.json`). One shared file was overwritten by every instance (`npm run dev`, smoke, capture):
 * Claude reloads a changed settings file, so the tabs of the app that kept running posted to a dead port
 * ("PostToolUse:Bash hook failed · connect ECONNREFUSED"). The legacy files read `$AQUILA_PORT` and stay shared.
 */
export const httpHookSettingsPath = (port: number, status = false) =>
  path.join(APP_DIR, `claude-hooks${status ? '-status' : ''}.${port}.json`);
const PER_PORT_FILE = /^claude-hooks(?:-status)?\.(\d+)\.json$/;
export const LEGACY_HOOK_SETTINGS_PATH = path.join(APP_DIR, 'claude-hooks-legacy.json');
/** The legacy file with our context statusline (T31), for sessions whose user has no `statusLine` of their own. */
export const STATUS_LEGACY_HOOK_SETTINGS_PATH = path.join(APP_DIR, 'claude-hooks-legacy-status.json');

/** `onFailure` and the hook fields we rely on: Claude Code 2.1.295 (the same release as OSC 7501). */
export const HTTP_HOOKS_SINCE: [number, number, number] = [2, 1, 295];

export const SESSION_HEADER = 'X-Aquila-Session';

/** Events we listen to, with their matcher. */
const EVENTS: Record<string, string | undefined> = {
  SessionStart: undefined,
  SessionEnd: undefined,
  UserPromptSubmit: undefined,
  PostToolUse: '*',
  PermissionRequest: '*',
  PermissionDenied: '*',
  Notification: WAITING_NOTIFICATIONS.join('|'),
  Stop: undefined,
  StopFailure: undefined,
  SubagentStart: '*',
  SubagentStop: '*',
};

const MAX_BODY = 1024 * 1024;

type HookHandler = Record<string, unknown>;

function httpHook(port: number): HookHandler {
  return {
    type: 'http',
    url: `http://127.0.0.1:${port}/hook`,
    headers: { [SESSION_HEADER]: '$AQUILA_TAB_ID' },
    allowedEnvVars: ['AQUILA_TAB_ID'],
    timeout: 5,
    onFailure: 'continue',
  };
}

/** Old Claude: the event JSON arrives on stdin; forward it as-is. */
const LEGACY_COMMAND =
  `[ -n "$AQUILA_PORT" ] && curl -s -m 1 -X POST -H "${SESSION_HEADER}: $AQUILA_TAB_ID" ` +
  '-H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:$AQUILA_PORT/hook" -o /dev/null; true';

/** Claude skips http hooks for these ("HTTP hooks are not supported for SessionStart"): command + curl there. */
const COMMAND_ONLY = new Set(['SessionStart', 'Setup']);
const COMMAND_HOOK: HookHandler = { type: 'command', command: LEGACY_COMMAND };

export function hookSettings(handler: HookHandler): { hooks: Record<string, unknown[]> } {
  const hooks: Record<string, unknown[]> = {};
  for (const [event, matcher] of Object.entries(EVENTS)) {
    const h = COMMAND_ONLY.has(event) ? COMMAND_HOOK : handler;
    hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [h] }];
  }
  return { hooks };
}

export interface HookSettingsFiles {
  http: string;
  legacy: string;
  /** `http` / `legacy` plus the context statusline. */
  httpStatus: string;
  legacyStatus: string;
}

/** Writes the settings files (the port is baked into this instance's http pair); returns their paths. */
export function writeClaudeHookSettings(port: number, dir = APP_DIR): HookSettingsFiles {
  fs.mkdirSync(dir, { recursive: true });
  const files: HookSettingsFiles = {
    http: path.join(dir, path.basename(httpHookSettingsPath(port))),
    legacy: path.join(dir, path.basename(LEGACY_HOOK_SETTINGS_PATH)),
    httpStatus: path.join(dir, path.basename(httpHookSettingsPath(port, true))),
    legacyStatus: path.join(dir, path.basename(STATUS_LEGACY_HOOK_SETTINGS_PATH)),
  };
  const http = hookSettings(httpHook(port));
  const legacy = hookSettings(COMMAND_HOOK);
  const write = (file: string, v: unknown) => fs.writeFileSync(file, JSON.stringify(v, null, 2));
  write(files.http, http);
  write(files.legacy, legacy);
  write(files.httpStatus, { ...http, ...statusLineSettings() });
  write(files.legacyStatus, { ...legacy, ...statusLineSettings() });
  return files;
}

/** On quit: this instance's http pair (the shared legacy files stay). */
export function removeClaudeHookSettings(files: HookSettingsFiles): void {
  for (const f of [files.http, files.httpStatus]) fs.rmSync(f, { force: true });
}

/** Something listens on 127.0.0.1:<port> (a live Aquila receiver), within `timeoutMs`. */
export function portListening(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Removes the http pairs left by instances that are gone (crashed, or quit before cleanup) — never the pair of a
 * port that still answers, which belongs to another running instance. The old shared `claude-hooks.json` from before
 * per-instance pairs is left alone: an older build that is still running spawns its tabs with it. Returns the removed
 * file names.
 */
export async function pruneStaleHookSettings(
  ownPort: number,
  dir = APP_DIR,
  alive: (port: number) => Promise<boolean> = portListening,
): Promise<string[]> {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  const checked = new Map<number, Promise<boolean>>();
  for (const name of names) {
    const m = PER_PORT_FILE.exec(name);
    const port = m ? Number(m[1]) : undefined;
    if (port === undefined || port === ownPort) continue;
    if (!checked.has(port)) checked.set(port, alive(port));
    if (await checked.get(port)) continue;
    fs.rmSync(path.join(dir, name), { force: true });
    removed.push(name);
  }
  return removed;
}

/** `2.1.328 (Claude Code)` → [2, 1, 328]; null when it doesn't look like a version. */
export function parseClaudeVersion(out: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(out);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function supportsHttpHooks(version: [number, number, number] | null): boolean {
  if (!version) return true; // unknown: assume a current Claude
  for (let i = 0; i < 3; i++) {
    if (version[i] !== HTTP_HOOKS_SINCE[i]) return version[i] > HTTP_HOOKS_SINCE[i];
  }
  return true;
}

/** `claude --version` with the session environment (PATH restored); null if it can't be run. */
export function detectClaudeVersion(
  env: NodeJS.ProcessEnv,
  bin = 'claude',
): Promise<[number, number, number] | null> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { env, timeout: 10_000 }, (err, stdout) =>
      resolve(err ? null : parseClaudeVersion(stdout)),
    );
  });
}

/** A hook as SessionManager gets it: the status signal plus the Claude session id and notification context. */
export type HookEvent = HookSignal & {
  sessionId?: string;
  /** PermissionRequest: `Bash: npm install`; Stop: first line of `last_assistant_message`; Notification: its message. */
  detail?: string;
  /** UserPromptSubmit: the prompt's first line, cut for a tab title (T43); absent for slash commands. */
  prompt?: string;
};

/** A tab title from the first prompt is about this long (T43). */
export const PROMPT_TITLE_MAX = 40;

/** First line of a prompt as a tab title; '' for slash commands (`/clear`, `/model`), which name nothing. */
export function promptTitle(prompt: string | undefined): string {
  const text = (prompt ?? '').trim();
  if (!text || text.startsWith('/')) return '';
  return firstLine(text, PROMPT_TITLE_MAX);
}

/** Notification context for the events that have some. */
function hookDetail(event: string, json: Record<string, unknown>): string {
  const str = (k: string) => (typeof json[k] === 'string' ? (json[k] as string) : undefined);
  switch (event) {
    case 'PermissionRequest':
      return toolSummary(str('tool_name'), json.tool_input);
    case 'Stop':
      return firstLine(str('last_assistant_message'));
    case 'Notification':
      return firstLine(str('message'));
  }
  return '';
}

/** Pulls what we use out of a hook's JSON. Large bodies past the cap still give us the event name. */
export function readHookBody(body: string): HookEvent | null {
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
  } catch {
    const m = /"hook_event_name"\s*:\s*"(\w+)"/.exec(body);
    return m ? { event: m[1] } : null;
  }
  const str = (k: string) => (typeof json?.[k] === 'string' ? (json[k] as string) : undefined);
  const event = str('hook_event_name');
  if (!event) return null;
  const sessionId = str('session_id');
  const detail = hookDetail(event, json ?? {});
  const prompt = event === 'UserPromptSubmit' ? promptTitle(str('prompt')) : '';
  return {
    event,
    notificationType: str('notification_type'),
    reason: str('reason'),
    error: str('error'),
    ...(isSessionId(sessionId) ? { sessionId } : {}),
    ...(detail ? { detail } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

export interface HookEventHandler {
  (tabId: string, hook: HookEvent): void;
}

/** Local receiver for `POST /hook` with the tab id in `X-Aquila-Session`. Always answers at once with no body. */
export function startHookServer(onHook: HookEventHandler): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const tab = req.headers[SESSION_HEADER.toLowerCase()];
      const ok =
        req.method === 'POST' && req.url === '/hook' && typeof tab === 'string' && /^[\w-]+$/.test(tab);
      if (!ok) {
        req.resume();
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        if (body.length < MAX_BODY) body += chunk;
      });
      req.on('end', () => {
        // Empty 2xx = no decision: we never approve or deny anything (PermissionRequest included).
        res.writeHead(204).end();
        const hook = readHookBody(body);
        if (hook) onHook(tab, hook);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}
