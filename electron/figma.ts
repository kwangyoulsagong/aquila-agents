// Figma MCP (T32), opt-in per project. Sessions of a project with `figma: true` get the official remote server:
//   claude → `--mcp-config ~/.aquila/mcp/figma.json` (no --strict-mcp-config: the user's own servers stay),
//   codex  → `-c mcp_servers.figma.url="…"` (checked on codex-cli 0.170: `codex -c … mcp list` shows it).
// Nothing is written to ~/.claude* / ~/.codex or the repo. Auth stays in the CLIs (`/mcp`, `codex mcp login figma`).
// "Connect" runs a short hidden `claude -p` that calls `whoami` and caches plan/seat per account.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FigmaPlan, FigmaProfile } from '../src/shared/api/types';
import { APP_DIR } from './config';
import { binaryFor } from './detect';

export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';
export const FIGMA_DOCS_URL = 'https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/';
export const FIGMA_MCP_PATH = path.join(APP_DIR, 'mcp', 'figma.json');
export const FIGMA_PROFILE_PATH = path.join(APP_DIR, 'figma-profile.json');

const PROBE_TIMEOUT_MS = 90_000;
const NO_TOOL = 'NO_FIGMA_TOOL';
const PROBE_PROMPT =
  'Call the figma whoami tool exactly once and reply with only its raw result, nothing else. ' +
  `If no figma tool is available, reply exactly ${NO_TOOL}.`;

export function mcpConfigJson(): string {
  return `${JSON.stringify({ mcpServers: { figma: { type: 'http', url: FIGMA_MCP_URL } } }, null, 2)}\n`;
}

/** Writes `~/.aquila/mcp/figma.json` when missing or different; returns its path. */
export function ensureMcpConfig(file = FIGMA_MCP_PATH): string {
  const want = mcpConfigJson();
  let have: string | null = null;
  try {
    have = fs.readFileSync(file, 'utf8');
  } catch {
    // missing → write it
  }
  if (have !== want) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, want);
  }
  return file;
}

/** Extra CLI arguments for a session of a Figma-enabled project, unquoted (the platform layer quotes them). */
export function figmaArgv(kind: 'claude' | 'codex', file = FIGMA_MCP_PATH): string[] {
  if (kind === 'claude') return ['--mcp-config', file];
  return ['-c', `mcp_servers.figma.url="${FIGMA_MCP_URL}"`];
}

// ── whoami parsing (defensive: the tool's shape isn't documented, so unknown → "unknown") ──

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** First balanced JSON object or array in `text` (Claude may wrap it in prose or a code fence). */
export function extractJson(text: string): Json | undefined {
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\') j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1)) as Json;
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

const isObj = (v: Json | undefined): v is { [k: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** First string value under one of `keys` (case-insensitive), searched depth-first. */
function findString(v: Json | undefined, keys: string[], depth = 0): string | undefined {
  if (depth > 6 || v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    for (const item of v) {
      const hit = findString(item, keys, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isObj(v)) return undefined;
  for (const [k, val] of Object.entries(v))
    if (keys.includes(k.toLowerCase()) && typeof val === 'string' && val.trim()) return val.trim();
  for (const val of Object.values(v)) {
    const hit = findString(val, keys, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

// Not `role`: whoami's role is admin/guest/member, not the seat.
const SEAT_KEYS = ['seat', 'seattype', 'seat_type', 'product_seat'];
const TIER_KEYS = ['tier', 'plan_tier', 'plantier', 'plan_type', 'type'];
const NAME_KEYS = ['name', 'plan_name', 'team_name', 'org_name'];

function toPlan(v: Json): FigmaPlan {
  return {
    name: findString(v, NAME_KEYS) ?? 'unknown',
    tier: findString(v, TIER_KEYS) ?? 'unknown',
    seat: findString(v, SEAT_KEYS) ?? 'unknown',
  };
}

/** First array under a plans/teams/orgs-like key, searched depth-first (whoami nests it: `{ whoami: { plans } }`). */
function findPlanList(v: Json | undefined, depth = 0): Json[] | undefined {
  if (depth > 4 || !isObj(v)) return undefined;
  for (const [k, val] of Object.entries(v))
    if (/^(plans?|teams?|orgs?|organizations?|memberships?)$/i.test(k) && Array.isArray(val)) return val;
  for (const val of Object.values(v)) {
    const hit = findPlanList(val, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

/** whoami result → plans (one per team/org). A single seat/tier without a list still counts as one plan. */
export function parsePlans(data: Json | undefined): FigmaPlan[] {
  if (!isObj(data)) return [];
  const list = findPlanList(data);
  if (list) return list.filter(isObj).map(toPlan);
  const plan = toPlan(data);
  return plan.seat !== 'unknown' || plan.tier !== 'unknown' ? [{ ...plan, name: 'unknown' }] : [];
}

/** The `result` text of `claude -p --output-format json` → profile. */
export function parseProbe(stdout: string, now = Date.now()): FigmaProfile {
  let result = '';
  let isError = false;
  try {
    const out = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
    result = typeof out.result === 'string' ? out.result : '';
    isError = out.is_error === true;
  } catch {
    return { state: 'error', checkedAt: now, plans: [], error: firstLine(stdout) || 'no output' };
  }
  if (result.includes(NO_TOOL)) return { state: 'needsAuth', checkedAt: now, plans: [] };
  const data = extractJson(result);
  if (isError || data === undefined)
    return { state: 'error', checkedAt: now, plans: [], error: firstLine(result) || 'no output' };
  const email = findString(data, ['email']);
  const handle = findString(data, ['handle', 'username', 'user_name']);
  return {
    state: 'connected',
    checkedAt: now,
    ...(email ? { email } : {}),
    ...(handle ? { handle } : {}),
    plans: parsePlans(data),
  };
}

function firstLine(text: string): string {
  return (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 200);
}

// ── profile cache: { [accountId]: FigmaProfile } ──

export function readProfiles(file = FIGMA_PROFILE_PATH): Record<string, FigmaProfile> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, FigmaProfile> = {};
    for (const [id, p] of Object.entries(raw as Record<string, Partial<FigmaProfile>>)) {
      if (!p || !['connected', 'needsAuth', 'error'].includes(String(p.state))) continue;
      out[id] = {
        ...p,
        state: p.state as FigmaProfile['state'],
        checkedAt: Number(p.checkedAt) || 0,
        plans: Array.isArray(p.plans) ? p.plans : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeProfile(account: string, profile: FigmaProfile, file = FIGMA_PROFILE_PATH): void {
  const all = { ...readProfiles(file), [account]: profile };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Runs the hidden probe with the account's Claude config dir (so it sees that account's `/mcp` login) and caches
 * the result. Only the Figma server is loaded (`--strict-mcp-config` is fine here: it's not a user session).
 */
export function connect(account: string, configDir: string | undefined): Promise<FigmaProfile> {
  const mcp = ensureMcpConfig();
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const args = [
    '-p',
    PROBE_PROMPT,
    '--mcp-config',
    mcp,
    '--strict-mcp-config',
    '--allowedTools',
    'mcp__figma__whoami',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--max-turns',
    '3',
    '--model',
    'haiku',
  ];
  return new Promise((resolve) => {
    execFile(
      binaryFor('claude'),
      args,
      { cwd: os.homedir(), env, timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const profile =
          err && !String(stdout).trim()
            ? {
                state: 'error' as const,
                checkedAt: Date.now(),
                plans: [],
                error: firstLine(String(stderr)) || err.message,
              }
            : parseProbe(String(stdout));
        try {
          writeProfile(account, profile);
        } catch (e) {
          console.error('[figma] cache', e);
        }
        resolve(profile);
      },
    );
  });
}
