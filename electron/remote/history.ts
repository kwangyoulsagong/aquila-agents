// Session history of SSH hosts (T36): the same transcripts T11 reads locally, read over the shared connection.
//
// Round trip 1 lists transcript files with mtime + size (Claude `<config dir>/projects/*/*.jsonl`, Codex
// `$CODEX_HOME/sessions/**/rollout-*.jsonl`), the remote home, Claude's settings.json and Codex's thread names.
// Round trip 2 fetches only files that are new or changed since the last scan — their first 256 KB, gzipped on the
// host — with the paths on stdin. Export fetches one whole file. Codex's SQLite store isn't read remotely.
// Read-only on the host, like T11.
import path from 'node:path';
import zlib from 'node:zlib';
import type { Config, RemoteHost } from '../../src/shared/api/types';
import { boundary, execError, parseSections, sectionLine, type RemoteExec } from './exec';
import { remotePath } from './ssh';

/** Bytes of each transcript fetched for the index (list, preview, search). */
export const REMOTE_HEAD = 256 * 1024;
/** Paths per fetch round trip (each answer is capped by REMOTE_HEAD, so this bounds a round trip's size). */
const FETCH_CHUNK = 64;

export interface RemoteFile {
  path: string;
  mtimeMs: number;
  size: number;
  agent: 'claude' | 'codex';
  /** Index into the scanned Claude config dirs (Claude files only). */
  dir?: number;
}

export interface RemoteListing {
  home: string;
  files: RemoteFile[];
  /** settings.json text per Claude config dir ('' when missing). */
  settings: string[];
  /** Tail of Codex's session_index.jsonl. */
  codexIndex: string;
}

/** The listing script. `claudeDirs` are config dirs on the host (`~/…`); `~/.claude` is Claude's default. */
export function listScript(b: string, claudeDirs: string[]): string {
  const lines = [
    // GNU stat (Linux) or BSD stat (macOS hosts): mtime in seconds, size, name.
    `if stat -c %Y / >/dev/null 2>&1; then SF=-c; FMT='%Y %s %n'; else SF=-f; FMT='%m %z %N'; fi`,
    sectionLine(b, 'home'),
    `printf '%s' "$HOME"`,
  ];
  claudeDirs.forEach((dir, i) => {
    lines.push(
      `d=${remotePath(dir)}`,
      sectionLine(b, `claude ${i}`),
      'stat $SF "$FMT" "$d"/projects/*/*.jsonl 2>/dev/null',
      sectionLine(b, `settings ${i}`),
      'head -c 65536 "$d"/settings.json 2>/dev/null',
    );
  });
  lines.push(
    'c="${CODEX_HOME:-$HOME/.codex}"',
    sectionLine(b, 'codex'),
    `find "$c"/sessions -type f -name 'rollout-*.jsonl' -exec stat $SF "$FMT" {} + 2>/dev/null`,
    sectionLine(b, 'codexindex'),
    'tail -c 262144 "$c"/session_index.jsonl 2>/dev/null',
    sectionLine(b, 'end'),
  );
  return lines.join('\n');
}

/** `<mtime s> <size> <path>` lines. */
function statLines(text: string): { path: string; mtimeMs: number; size: number }[] {
  const out: { path: string; mtimeMs: number; size: number }[] = [];
  for (const line of text.split('\n')) {
    const m = /^(\d+) (\d+) (\/.+)$/.exec(line);
    if (m) out.push({ mtimeMs: Number(m[1]) * 1000, size: Number(m[2]), path: m[3] });
  }
  return out;
}

export function parseListing(out: string, b: string, dirs: number): RemoteListing {
  const sec = parseSections(out, b);
  const files: RemoteFile[] = [];
  const settings: string[] = [];
  for (let i = 0; i < dirs; i++) {
    for (const f of statLines(sec.get(`claude ${i}`) ?? '')) files.push({ ...f, agent: 'claude', dir: i });
    settings.push(sec.get(`settings ${i}`) ?? '');
  }
  for (const f of statLines(sec.get('codex') ?? '')) files.push({ ...f, agent: 'codex' });
  return { home: (sec.get('home') ?? '').trim(), files, settings, codexIndex: sec.get('codexindex') ?? '' };
}

export async function listRemote(
  exec: RemoteExec,
  host: RemoteHost,
  claudeDirs: string[],
): Promise<RemoteListing> {
  const b = boundary();
  const r = await exec(host, listScript(b, claudeDirs), { timeoutMs: 30_000 });
  const out = r.stdout.toString('utf8');
  if (!out.includes(`${b} end`)) throw new Error(execError(r, `ssh ${host.alias} failed`));
  return parseListing(out, b, claudeDirs.length);
}

/**
 * Fetch script: paths on stdin, one per line; each file's first `cap` bytes (0 = whole) after a numbered section
 * line, gzipped when the host has gzip. Starts with `<boundary> gz` / `<boundary> raw` so login noise is skipped.
 */
export function fetchScript(b: string, cap: number): string {
  const read = cap > 0 ? `head -c ${cap} "$f"` : 'cat "$f"';
  const loop = `n=0; while IFS= read -r f; do printf '\\n%s %s\\n' '${b}' "$n"; ${read} 2>/dev/null; n=$((n+1)); done; ${sectionLine(b, 'end')}`;
  return [
    `if command -v gzip >/dev/null 2>&1; then printf '%s gz\\n' '${b}'; { ${loop}; } | gzip -c;`,
    `else printf '%s raw\\n' '${b}'; ${loop}; fi`,
  ].join('\n');
}

/** Output of `fetchScript` → text per input index. */
export function parseFetched(stdout: Buffer, b: string): Map<number, string> | null {
  for (const mode of ['gz', 'raw'] as const) {
    const marker = Buffer.from(`${b} ${mode}\n`);
    const at = stdout.indexOf(marker);
    if (at < 0) continue;
    const body = stdout.subarray(at + marker.length);
    const text = (mode === 'gz' ? zlib.gunzipSync(body) : body).toString('utf8');
    if (!text.includes(`\n${b} end`)) return null;
    const out = new Map<number, string>();
    for (const [k, v] of parseSections(text, b)) if (k !== 'end') out.set(Number(k), v);
    return out;
  }
  return null;
}

/** Files' heads (or whole files with cap 0), in chunks; path → text. A failed chunk throws. */
export async function fetchFiles(
  exec: RemoteExec,
  host: RemoteHost,
  paths: string[],
  cap = REMOTE_HEAD,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length; i += FETCH_CHUNK) {
    const chunk = paths.slice(i, i + FETCH_CHUNK).filter((p) => !p.includes('\n'));
    const b = boundary();
    const r = await exec(host, fetchScript(b, cap), {
      input: `${chunk.join('\n')}\n`,
      timeoutMs: 90_000,
      maxBytes: cap > 0 ? 64 * 1024 * 1024 : 256 * 1024 * 1024,
    });
    let parsed: Map<number, string> | null = null;
    try {
      parsed = parseFetched(r.stdout, b);
    } catch {
      parsed = null;
    }
    if (!parsed) throw new Error(execError(r, `ssh ${host.alias} failed`));
    chunk.forEach((p, n) => {
      const text = parsed?.get(n);
      if (text !== undefined) out.set(p, text);
    });
  }
  return out;
}

/** A project's folder on the host as an absolute path: `~` / `~/x` / `x` are under the remote home. */
export function hostPath(p: string, home: string): string {
  const v = p.trim();
  if (v === '~') return home;
  if (v.startsWith('~/')) return path.posix.join(home, v.slice(2));
  return v.startsWith('/') ? path.posix.normalize(v) : path.posix.join(home, v);
}

/** The remote project (same SSH host) whose folder holds `cwd`; deepest wins. */
export function matchRemoteProject(
  config: Config,
  alias: string,
  home: string,
  cwd: string,
): string | undefined {
  let best: { id: string; len: number } | undefined;
  const dir = path.posix.normalize(cwd);
  for (const p of config.projects) {
    if (p.remote?.alias !== alias) continue;
    const root = hostPath(p.path, home).replace(/\/+$/, '') || '/';
    const inside = dir === root || dir.startsWith(root === '/' ? '/' : `${root}/`);
    if (inside && (!best || root.length > best.len)) best = { id: p.id, len: root.length };
  }
  return best?.id;
}

/** SSH hosts of the configured remote projects, with the Claude config dirs used on each. */
export function remoteHosts(config: Config): { host: RemoteHost; claudeDirs: string[] }[] {
  const byAlias = new Map<string, { host: RemoteHost; claudeDirs: string[] }>();
  for (const p of config.projects) {
    if (!p.remote) continue;
    const dir = p.remote.claudeConfigDir?.trim() || '~/.claude';
    const h = byAlias.get(p.remote.alias) ?? { host: p.remote, claudeDirs: [] };
    if (!h.claudeDirs.includes(dir)) h.claudeDirs.push(dir);
    byAlias.set(p.remote.alias, h);
  }
  return [...byAlias.values()];
}
