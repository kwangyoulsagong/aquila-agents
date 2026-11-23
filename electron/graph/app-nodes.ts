/**
 * The app in the graph (T70): Claude / Codex sessions, the files they changed, trend items and the apply decisions
 * taken on them, connected to notes by what actually happened — a note `@`-mentioned in a session (sent to Claude),
 * a file edited in it, a trend applied on its branch.
 *
 * Built from data the app already has (the history index's last scan, `~/.aquila/applies`); nothing is scanned or
 * polled here. Only sessions that touched a note or ran an applied trend are shown, so the graph stays about notes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ApplyRecord,
  GraphEdge,
  GraphEdgeReason,
  GraphNode,
  HistoryEntry,
  Language,
} from '../../src/shared/api/types';
import { ClaudeParser, displayTitle, parseText, type SessionWork } from '../history';

/** Most recent sessions kept. */
export const MAX_SESSIONS = 200;
/** Changed files kept per session. */
export const MAX_FILES_PER_SESSION = 40;
/** A file edge to a code name of the same file: weaker than the session's own edges. */
const CODE_STRENGTH = 0.7;

export interface AppProject {
  id: string;
  /** Absolute. */
  root: string;
}

export interface AppData {
  sessions: SessionWork[];
  applies: ApplyRecord[];
  projects: AppProject[];
  /** Files Claude turns changed by any means (`TurnFiles`), by Claude session id. */
  turnFiles?: Record<string, string[]>;
}

/** FSD layers: `src/<layer>` is a folder of its own in the skeleton (as in T64's scan). */
const FSD_LAYERS = new Set(['app', 'pages', 'widgets', 'features', 'entities', 'shared']);

/**
 * The code-skeleton folder a project file belongs to, from its path alone (no scan): `src/<layer>` for an FSD
 * layer, else the top-level folder; null for a file at the root.
 */
export function skeletonFolder(rel: string): string | null {
  const parts = rel.split('/');
  if (parts.length < 2) return null;
  if (parts[0] === 'src' && parts.length > 2 && FSD_LAYERS.has(parts[1]!)) return `src/${parts[1]}`;
  return parts[0]!;
}

export const folderNodeId = (projectId: string, folder: string) => `code:dir:${projectId}:${folder}`;

export interface AppGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const sessionNodeId = (agent: string, id: string) => `session:${agent}:${id}`;
export const fileNodeId = (abs: string) => `file:${abs}`;
export const trendNodeId = (itemId: string) => `trend:${itemId}`;
export const applyNodeId = (id: string) => `apply:${id}`;

/** A path from a transcript → absolute (`~/…` under home, relative under the session's folder). */
export function resolveIn(cwd: string, p: string, home = os.homedir()): string {
  if (p === '~' || p.startsWith('~/')) return path.join(home, p.slice(1));
  return path.resolve(cwd, p);
}

/** A session's title without the `@path`s pasted into it (the note is its neighbour in the graph anyway). */
export const sessionLabel = (title: string) =>
  title
    .replace(/@"[^"]*"|@\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || title;

const inside = (file: string, root: string) =>
  file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

class Edges {
  private map = new Map<string, GraphEdge>();
  add(source: string, target: string, reason: GraphEdgeReason, strength = 1): void {
    const id = `${source}→${target}`;
    const e = this.map.get(id);
    if (e) {
      if (!e.reasons.some((r) => r.via === reason.via && r.label === reason.label)) e.reasons.push(reason);
      e.strength = Math.max(e.strength, strength);
      return;
    }
    this.map.set(id, { id, source, target, kind: 'action', strength, reasons: [reason] });
  }
  list(): GraphEdge[] {
    return [...this.map.values()];
  }
}

/**
 * App nodes and action edges for an index snapshot's `nodes` (notes with their paths, code names). Edges run the
 * way the work went: note → session → changed file, trend → apply → session. A session that edited a note links to
 * that note instead of a file node; a changed file whose name is a code name in the index links to it.
 */
export function appGraph(index: readonly GraphNode[], data: AppData, home = os.homedir()): AppGraph {
  const taken = new Set(index.map((n) => n.id));
  const noteByPath = new Map<string, string>();
  const codeByName = new Map<string, string>();
  for (const n of index) {
    if (n.kind === 'note' && n.path) noteByPath.set(path.resolve(n.path), n.id);
    if (n.kind === 'code') codeByName.set(n.label.toLowerCase(), n.id);
  }
  const nodes = new Map<string, GraphNode>();
  const edges = new Edges();
  const put = (n: GraphNode) => {
    if (taken.has(n.id)) return;
    const had = nodes.get(n.id);
    if (!had) nodes.set(n.id, n);
    else if ((n.mtime ?? 0) > (had.mtime ?? 0)) had.mtime = n.mtime;
  };
  const projectOf = (file: string) =>
    data.projects.filter((p) => inside(file, p.root)).sort((a, b) => b.root.length - a.root.length)[0];

  // Trends and the decisions taken on them. An applied one is found again by its worktree branch.
  const appliedOn = new Map<string, string>();
  for (const r of data.applies) {
    const trend = trendNodeId(r.article.itemId);
    const apply = applyNodeId(r.id);
    put({ id: trend, kind: 'trend', label: r.article.title, url: r.article.url, mtime: r.createdAt });
    put({
      id: apply,
      kind: 'apply',
      label: r.branch ?? r.article.title,
      mtime: r.decidedAt ?? r.createdAt,
      projects: [r.projectId],
    });
    edges.add(trend, apply, { via: 'apply', label: r.decision });
    if (r.decision === 'applied' && r.branch) appliedOn.set(`${r.projectId}\0${r.branch}`, apply);
  }

  const sessions = [...data.sessions].sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
  let kept = 0;
  for (const { entry, files: edited, mentions } of sessions) {
    if (kept >= MAX_SESSIONS) break;
    if (entry.host) continue; // remote transcripts: paths are on another machine
    const sent = [
      ...new Set(mentions.map((m) => noteByPath.get(resolveIn(entry.cwd, m, home))).filter((x) => !!x)),
    ] as string[];
    const apply =
      entry.projectId && entry.branch ? appliedOn.get(`${entry.projectId}\0${entry.branch}`) : undefined;
    if (!sent.length && !apply) continue;
    kept++;
    const files =
      entry.agent === 'claude' && data.turnFiles?.[entry.id]
        ? [...new Set([...edited, ...data.turnFiles[entry.id]!])]
        : edited;
    const sid = sessionNodeId(entry.agent, entry.id);
    put({
      id: sid,
      kind: 'session',
      label: sessionLabel(displayTitle(entry)),
      path: entry.cwd,
      mtime: entry.updatedAt,
      ...(entry.projectId ? { projects: [entry.projectId] } : {}),
    });
    for (const note of sent) edges.add(note, sid, { via: 'session', label: entry.agent });
    if (apply) edges.add(apply, sid, { via: 'session', label: entry.branch });

    let shown = 0;
    for (const f of files) {
      if (shown >= MAX_FILES_PER_SESSION) break;
      const abs = resolveIn(entry.cwd, f, home);
      const note = noteByPath.get(abs);
      if (note) {
        edges.add(sid, note, { via: 'changed' });
        shown++;
        continue;
      }
      const project = projectOf(abs);
      const base = project ?? (inside(abs, entry.cwd) ? { root: entry.cwd } : null);
      const fid = fileNodeId(abs);
      put({
        id: fid,
        kind: 'file',
        label: base ? path.relative(base.root, abs).split(path.sep).join('/') : abs,
        path: abs,
        mtime: entry.updatedAt,
        ...(project ? { projects: [project.id] } : {}),
      });
      edges.add(sid, fid, { via: 'changed' });
      const name = path.basename(abs);
      const code = codeByName.get(name.toLowerCase());
      if (code) edges.add(fid, code, { via: 'code', label: name }, CODE_STRENGTH);
      // The skeleton folder it is in (`src/features`, `electron`): files of one area meet there.
      const folder = project && skeletonFolder(path.relative(project.root, abs).split(path.sep).join('/'));
      if (project && folder) {
        const did = folderNodeId(project.id, folder);
        put({
          id: did,
          kind: 'code',
          label: `${folder}/`,
          path: path.join(project.root, folder),
          projects: [project.id],
        });
        edges.add(fid, did, { via: 'code', label: folder }, CODE_STRENGTH);
      }
      shown++;
    }
  }
  return { nodes: [...nodes.values()], edges: edges.list() };
}

/**
 * Caches what `appGraph` needs between snapshots: `load` (the history index's `list` + `work`, the applies) runs on
 * the first snapshot and again only after `invalidate()` (a hook said a turn ended, an apply was decided).
 */
export class AppNodes {
  private data: Promise<AppData> | null = null;

  constructor(
    private load: () => Promise<AppData>,
    private home = os.homedir(),
  ) {}

  invalidate(): void {
    this.data = null;
  }

  async graph(index: readonly GraphNode[]): Promise<AppGraph> {
    this.data ??= this.load().catch((e: unknown) => {
      console.error('[graph] app nodes failed:', e);
      this.data = null;
      return { sessions: [], applies: [], projects: [] };
    });
    return appGraph(index, await this.data, this.home);
  }
}

/**
 * Smoke: Claude transcripts (`<id>.jsonl`) in a throwaway folder read as sessions, so the note → session → file path
 * can be checked without anyone's real history.
 */
export function transcriptsWork(dir: string, projectOf: (abs: string) => string | undefined): SessionWork[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return names.flatMap((n): SessionWork[] => {
    const p = parseText(fs.readFileSync(path.join(dir, n), 'utf8'), new ClaudeParser()).result(0);
    if (!p) return [];
    const projectId = projectOf(path.join(p.cwd, '.'));
    return [
      {
        entry: {
          agent: 'claude',
          id: n.slice(0, -6),
          cwd: p.cwd,
          firstMessage: p.firstMessage,
          startedAt: p.startedAt,
          updatedAt: p.updatedAt,
          messages: p.count,
          favorite: false,
          ...(projectId ? { projectId } : {}),
        },
        files: p.files ?? [],
        mentions: p.mentions ?? [],
      },
    ];
  });
}

// ── Daily note of the day's sessions (T70, optional) ──────────────────────────

/** Sessions listed in one daily note at most. */
export const MAX_DAILY = 60;
const DAILY_FILES = 5;

export interface DailyInput {
  /** Every session the history index knows (local and the last SSH scan). */
  entries: HistoryEntry[];
  work: SessionWork[];
  turnFiles?: Record<string, string[]>;
  projects: (AppProject & { name: string })[];
  /** The absolute path is a note of an enabled source (it gets a `[[link]]`). */
  isNote: (abs: string) => boolean;
  language: Language;
  now: Date;
  home?: string;
}

/** `claude:1a2b3c4d` (`@host` for a remote one): how a line is found again, so a session is listed once. */
export const sessionToken = (e: Pick<HistoryEntry, 'agent' | 'id' | 'host'>) =>
  `${e.agent}:${e.id.slice(0, 8)}${e.host ? `@${e.host}` : ''}`;

const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dailyHeading = (language: Language) => (language === 'ko' ? '## 세션' : '## Sessions');
export const dailyTitle = (d: Date, language: Language) =>
  `${localDate(d)} ${language === 'ko' ? '세션' : 'sessions'}`;

/**
 * The day's sessions as list lines, oldest first: time · agent · title · project (or host) · the notes it got as
 * `[[links]]` · the files it changed (a few) · its token.
 */
export function dailyLines(input: DailyInput): string[] {
  const home = input.home ?? os.homedir();
  const start = new Date(input.now);
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 86_400_000;
  const work = new Map(input.work.map((w) => [`${w.entry.agent}:${w.entry.id}@${w.entry.host ?? ''}`, w]));
  const names = new Map(input.projects.map((p) => [p.id, p.name]));
  return input.entries
    .filter((e) => e.updatedAt >= start.getTime() && e.updatedAt < end)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-MAX_DAILY)
    .map((e) => {
      const w = work.get(`${e.agent}:${e.id}@${e.host ?? ''}`);
      const at = new Date(Math.max(e.startedAt, start.getTime()));
      const parts = [
        `${pad(at.getHours())}:${pad(at.getMinutes())}`,
        e.agent === 'claude' ? 'Claude' : 'Codex',
        sessionLabel(displayTitle(e)).replace(/\s+/g, ' ').slice(0, 80),
      ];
      const where = e.host ?? (e.projectId ? names.get(e.projectId) : undefined);
      if (where) parts.push(where);
      if (!e.host && w) {
        const notes = [
          ...new Set(
            w.mentions
              .map((m) => resolveIn(e.cwd, m, home))
              .filter((abs) => input.isNote(abs))
              .map((abs) => `[[${path.basename(abs).replace(/\.md$/i, '')}]]`),
          ),
        ];
        if (notes.length) parts.push(notes.join(' '));
        const project = e.projectId ? input.projects.find((p) => p.id === e.projectId) : undefined;
        const root = project?.root ?? e.cwd;
        const files = [
          ...new Set([...w.files, ...(e.agent === 'claude' ? (input.turnFiles?.[e.id] ?? []) : [])]),
        ]
          .map((f) => resolveIn(e.cwd, f, home))
          .filter((abs) => !input.isNote(abs))
          .map((abs) => (inside(abs, root) ? path.relative(root, abs).split(path.sep).join('/') : abs));
        if (files.length)
          parts.push(
            files
              .slice(0, DAILY_FILES)
              .map((f) => `\`${f}\``)
              .join(', ') + (files.length > DAILY_FILES ? ` +${files.length - DAILY_FILES}` : ''),
          );
      }
      return `- ${parts.join(' · ')} \`${sessionToken(e)}\``;
    });
}

/**
 * `text` with the lines it doesn't have yet (by token) added at the end of the `heading` section — the section is
 * added at the end when missing. Everything else is left byte for byte.
 */
export function addToSection(text: string, heading: string, lines: string[]): string {
  const fresh = lines.filter((l) => {
    const token = /`([^`]+)`$/.exec(l)?.[1];
    return !token || !text.includes(`\`${token}\``);
  });
  if (!fresh.length) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const all = text.split(/\r?\n/);
  const at = all.findIndex((l) => l.trim() === heading);
  if (at < 0) {
    const body = text.replace(/\s*$/, '');
    return `${body}${body ? eol + eol : ''}${heading}${eol}${eol}${fresh.join(eol)}${eol}`;
  }
  let end = all.findIndex((l, i) => i > at && /^#{1,2} /.test(l));
  if (end < 0) end = all.length;
  // After the section's last non-empty line.
  let last = end;
  while (last > at + 1 && !all[last - 1]!.trim()) last--;
  const insertAt = last === at + 1 ? at + 1 : last;
  const before = all.slice(0, insertAt);
  if (insertAt === at + 1) before.push('');
  return [...before, ...fresh, ...all.slice(insertAt)].join(eol);
}
