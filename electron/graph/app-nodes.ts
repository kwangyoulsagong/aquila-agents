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
import type { ApplyRecord, GraphEdge, GraphEdgeReason, GraphNode } from '../../src/shared/api/types';
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
}

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
  for (const { entry, files, mentions } of sessions) {
    if (kept >= MAX_SESSIONS) break;
    if (entry.host) continue; // remote transcripts: paths are on another machine
    const sent = [
      ...new Set(mentions.map((m) => noteByPath.get(resolveIn(entry.cwd, m, home))).filter((x) => !!x)),
    ] as string[];
    const apply =
      entry.projectId && entry.branch ? appliedOn.get(`${entry.projectId}\0${entry.branch}`) : undefined;
    if (!sent.length && !apply) continue;
    kept++;
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
