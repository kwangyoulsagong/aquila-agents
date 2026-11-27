// Note explorer (T83), main-process side: new folder / new note / rename / move / Trash inside enabled note sources.
// Every path the renderer sends is checked here: a known, enabled source; `/`-separated parts with no `..`, empty or
// hidden part; the deepest existing folder on the way resolved through symlinks must still be inside the source.
// Nothing is ever overwritten (a taken name is an error), and links are only rewritten when the user says yes
// (`fixLinks`), through the same refuse-if-changed write the editor uses.
import fs from 'node:fs';
import path from 'node:path';
import type {
  GraphSnapshot,
  NoteFsEntry,
  NoteFsLinkNote,
  NoteFsLinkResult,
  NoteFsList,
  NoteFsMove,
  NoteFsMoveResult,
  NoteFsPrefs,
  NoteFsResult,
  NoteFsSort,
} from '../../src/shared/api/types';
import { applySplices, linkSplices, type FileMove } from './link-rewrite';
import { readNote, writeNote } from './note-file';
import type { VaultNote } from './vault';
import { SKIP_DIRS } from './code';

export interface NoteFsGraph {
  sourceRoot(id: string): string | null;
  enabledIds(): string[];
  notes(id: string): Promise<VaultNote[]>;
  snapshot(opts: { app?: boolean }): Promise<GraphSnapshot>;
}

export interface NoteFsOptions {
  graph: NoteFsGraph;
  /** The new note's file name + text from the source's template (`vault.draft`). */
  draft: (id: string, title: string) => { name: string; text: string } | null;
  /** Moves a path to the macOS Trash (`shell.trashItem`). */
  trash: (abs: string) => Promise<void>;
  /** `~/.aquila/explorer.json`. */
  prefsFile: string;
}

const NAME_MAX = 200;
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);
const posix = (p: string) => p.split(path.sep).join('/');
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** A file or folder name the user typed, trimmed; null if it can't be one (a `/`, hidden, `..`, too long). */
export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.trim().normalize('NFC');
  if (!n || n.length > NAME_MAX || n === '.' || n === '..' || n.startsWith('.')) return null;
  if (/[/\\:\0]/.test(n)) return null;
  return n;
}

/** A note's file name: `.md` added when missing. */
export const noteName = (name: string) => (/\.md$/i.test(name) ? name : `${name}.md`);

/**
 * The absolute path of `rel` inside `root`, or null: no empty / `.` / `..` / hidden parts, and the deepest part
 * that exists, with symlinks resolved, is still inside the source (a link pointing out of it is refused).
 */
export function resolveInside(root: string, rel: unknown): string | null {
  if (typeof rel !== 'string') return null;
  if (rel === '') return path.resolve(root);
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.') || /[\\\0]/.test(p))) return null;
  const abs = path.join(path.resolve(root), ...parts);
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }
  // The deepest existing ancestor (or the path itself) resolved through symlinks.
  let p = abs;
  while (!fs.lstatSync(p, { throwIfNoEntry: false })) {
    const up = path.dirname(p);
    if (up === p) return null;
    p = up;
  }
  try {
    // A symlink itself (renaming / trashing the link) is fine; where it's kept must be inside.
    const st = fs.lstatSync(p);
    const real =
      st.isSymbolicLink() && p === abs
        ? path.join(fs.realpathSync(path.dirname(p)), path.basename(p))
        : fs.realpathSync(p);
    return inside(real, realRoot) ? abs : null;
  } catch {
    return null;
  }
}

/** Taken: something is at `to`, other than `from` itself under another case (a case-only rename on APFS). */
function taken(from: string | null, to: string): boolean {
  const st = fs.lstatSync(to, { throwIfNoEntry: false });
  if (!st) return false;
  if (!from) return true;
  const a = fs.lstatSync(from, { throwIfNoEntry: false });
  return !a || a.ino !== st.ino || a.dev !== st.dev;
}

const SORTS: readonly NoteFsSort[] = ['name', 'modified', 'created'];
const EMPTY_PREFS = (): NoteFsPrefs => ({ pins: [], recent: [], sort: 'name' });
const strings = (x: unknown, max: number) =>
  Array.isArray(x)
    ? x.filter((s): s is string => typeof s === 'string' && s.length < 1024).slice(0, max)
    : [];

export function cleanPrefs(raw: unknown): NoteFsPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    pins: strings(o.pins, 50),
    recent: strings(o.recent, 20),
    sort: SORTS.includes(o.sort as NoteFsSort) ? (o.sort as NoteFsSort) : 'name',
    // Only what differs from the defaults is kept.
    ...(o.group === 'status' ? { group: 'status' as const } : {}),
    ...(o.folderNotes === false ? { folderNotes: false } : {}),
    ...(o.compact === false ? { compact: false } : {}),
    ...(o.links === 'always' || o.links === 'never' ? { links: o.links } : {}),
  };
}

export class NoteFs {
  constructor(private opts: NoteFsOptions) {}

  /** The folder of an enabled source, or null. */
  private root(id: unknown): string | null {
    if (typeof id !== 'string' || !this.opts.graph.enabledIds().includes(id)) return null;
    return this.opts.graph.sourceRoot(id);
  }

  async list(id: string, created = false): Promise<NoteFsList | null> {
    const root = this.root(id);
    if (!root) return null;
    const notes = await this.opts.graph.notes(id);
    const files: NoteFsEntry[] = await Promise.all(
      notes.map(async (n) => {
        const status = n.frontmatter.status;
        const e: NoteFsEntry = {
          rel: n.rel,
          title: n.title,
          mtime: n.mtime,
          ...(typeof status === 'string' && status ? { status: status.slice(0, 40) } : {}),
        };
        if (created) {
          const st = await fs.promises.stat(n.abs).catch(() => null);
          if (st) e.ctime = st.birthtimeMs || st.ctimeMs;
        }
        return e;
      }),
    );
    return { sourceId: id, root, files };
  }

  /** Sub-folders of `rel` with no file directly inside (folders with notes come from the index). */
  dirs(id: string, rel: string): string[] {
    const root = this.root(id);
    const dir = root ? resolveInside(root, rel) : null;
    if (!dir) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      if (out.length >= 200) break;
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name) || e.name === 'node_modules')
        continue;
      try {
        const inner = fs.readdirSync(path.join(dir, e.name), { withFileTypes: true });
        if (!inner.some((x) => !x.name.startsWith('.') && !x.isDirectory())) out.push(e.name);
      } catch {
        // unreadable: left out
      }
    }
    return out;
  }

  mkdir(id: string, parent: string, name: string): NoteFsResult {
    const root = this.root(id);
    const n = cleanName(name);
    if (!root) return { ok: false, error: 'refused' };
    if (!n) return { ok: false, error: 'badName' };
    const rel = join(parent, n);
    const abs = resolveInside(root, rel);
    if (!abs || !resolveInside(root, parent)) return { ok: false, error: 'refused' };
    if (taken(null, abs)) return { ok: false, error: 'exists' };
    try {
      fs.mkdirSync(abs);
      return { ok: true, rel };
    } catch {
      return { ok: false, error: 'failed' };
    }
  }

  createNote(id: string, folder: string, title: string): NoteFsResult {
    const root = this.root(id);
    const t = cleanName(title);
    if (!root) return { ok: false, error: 'refused' };
    if (!t) return { ok: false, error: 'badName' };
    const draft = this.opts.draft(id, t.replace(/\.md$/i, '')) ?? { name: noteName(t), text: `# ${t}\n\n` };
    const name = cleanName(draft.name);
    if (!name) return { ok: false, error: 'badName' };
    const rel = join(folder, noteName(name));
    const abs = resolveInside(root, rel);
    if (!abs || !resolveInside(root, folder)) return { ok: false, error: 'refused' };
    if (taken(null, abs)) return { ok: false, error: 'exists' };
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, draft.text, { flag: 'wx' });
      return { ok: true, rel, mtime: fs.statSync(abs).mtimeMs };
    } catch (e) {
      return { ok: false, error: (e as NodeJS.ErrnoException).code === 'EEXIST' ? 'exists' : 'failed' };
    }
  }

  async rename(id: string, rel: string, name: string): Promise<NoteFsMoveResult> {
    const root = this.root(id);
    if (!root) return { ok: false, error: 'refused' };
    const from = resolveInside(root, rel);
    if (!from || rel === '') return { ok: false, error: 'refused' };
    const st = fs.lstatSync(from, { throwIfNoEntry: false });
    if (!st) return { ok: false, error: 'notFound' };
    const n = cleanName(name);
    if (!n) return { ok: false, error: 'badName' };
    const to = join(dirOf(rel), st.isDirectory() ? n : noteName(n));
    if (to === rel) return { ok: true, moved: [], files: [], links: [] };
    return this.apply(id, root, [{ from: rel, to }]);
  }

  async move(id: string, rels: string[], folder: string): Promise<NoteFsMoveResult> {
    const root = this.root(id);
    if (!root || !Array.isArray(rels) || !resolveInside(root, folder)) return { ok: false, error: 'refused' };
    const dest = resolveInside(root, folder)!;
    if (!fs.statSync(dest, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: 'notFound' };
    // A folder and something inside it both picked: the folder carries it.
    const list = [...new Set(rels.filter((r) => typeof r === 'string' && r))];
    const top = list.filter((r) => !list.some((o) => o !== r && r.startsWith(`${o}/`)));
    const moves: NoteFsMove[] = [];
    for (const r of top) {
      if (folder === r || folder.startsWith(`${r}/`)) return { ok: false, error: 'refused' };
      if (dirOf(r) === folder) continue; // already there: nothing to do
      moves.push({ from: r, to: join(folder, baseOf(r)) });
    }
    if (!moves.length) return { ok: true, moved: [], files: [], links: [] };
    return this.apply(id, root, moves);
  }

  /** Renames each item (refusing a taken name), then finds the notes whose links point at what moved. */
  private async apply(id: string, root: string, moves: NoteFsMove[]): Promise<NoteFsMoveResult> {
    for (const m of moves) {
      const a = resolveInside(root, m.from);
      const b = resolveInside(root, m.to);
      if (!a || !b) return { ok: false, error: 'refused' };
      if (!fs.lstatSync(a, { throwIfNoEntry: false })) return { ok: false, error: 'notFound' };
      if (taken(a, b)) return { ok: false, error: 'exists' };
    }
    // Before anything moves: which notes moved (a folder's from the index) and who links to them.
    const notes = await this.opts.graph.notes(id);
    const files: FileMove[] = [];
    for (const m of moves) {
      const isDir = fs.lstatSync(resolveInside(root, m.from)!)?.isDirectory();
      if (!isDir) files.push(m);
      else
        for (const n of notes)
          if (n.rel.startsWith(`${m.from}/`))
            files.push({ from: n.rel, to: m.to + n.rel.slice(m.from.length) });
    }
    const linking = await this.linkers(id, root, files);
    const done: NoteFsMove[] = [];
    for (const m of moves) {
      try {
        fs.renameSync(resolveInside(root, m.from)!, resolveInside(root, m.to)!);
        done.push(m);
      } catch {
        return { ok: false, error: 'failed', moved: done };
      }
    }
    const newOf = new Map(files.map((f) => [f.from, f.to]));
    const candidates = new Set([...linking].map((r) => newOf.get(r) ?? r));
    for (const f of files) candidates.add(f.to);
    const links: NoteFsLinkNote[] = [];
    const oldOf = new Map(files.map((f) => [f.to, f.from]));
    for (const rel of candidates) {
      const abs = resolveInside(root, rel);
      const note = abs ? readNote(abs) : null;
      if (!note || note.readOnly) continue;
      const count = linkSplices(note.text, oldOf.get(rel) ?? rel, rel, files).length;
      if (count) links.push({ rel, count });
    }
    links.sort((a, b) => a.rel.localeCompare(b.rel));
    return { ok: true, moved: done, files, links };
  }

  /** Notes (old paths) with a written link to one of the moving notes, from the index's edges. */
  private async linkers(id: string, root: string, files: readonly FileMove[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!files.length) return out;
    const snap = await this.opts.graph.snapshot({ app: false });
    const relOf = new Map<string, string>();
    for (const n of snap.nodes)
      if (n.kind === 'note' && n.sourceId === id && n.path)
        relOf.set(n.id, posix(path.relative(root, n.path)));
    const targets = new Set(files.map((f) => f.from));
    for (const e of snap.edges) {
      const to = relOf.get(e.target);
      const from = relOf.get(e.source);
      if (!to || !from || (!targets.has(to) && !targets.has(from))) continue;
      if (!e.reasons.some((r) => r.via === 'link' || r.via === 'frontmatter')) continue;
      // The index keeps one direction per pair (a mutual link is stored once), so either end may be the linker;
      // a candidate with nothing to rewrite is dropped later.
      if (targets.has(to)) out.add(from);
      if (targets.has(from)) out.add(to);
    }
    return out;
  }

  /** Rewrites the link spans in each note; a note that changed since it was read is left alone. */
  fixLinks(id: string, files: NoteFsMove[], notes: string[]): NoteFsLinkResult {
    const root = this.root(id);
    const out: NoteFsLinkResult = { fixed: 0, failed: [] };
    if (!root || !Array.isArray(files) || !Array.isArray(notes)) return out;
    const moves = files.filter((f) => typeof f?.from === 'string' && typeof f?.to === 'string');
    const oldOf = new Map(moves.map((f) => [f.to, f.from]));
    for (const rel of notes) {
      const abs = typeof rel === 'string' && /\.md$/i.test(rel) ? resolveInside(root, rel) : null;
      const note = abs ? readNote(abs) : null;
      if (!abs || !note || note.readOnly) {
        out.failed.push(String(rel));
        continue;
      }
      const splices = linkSplices(note.text, oldOf.get(rel) ?? rel, rel, moves);
      if (!splices.length) continue;
      const res = writeNote(abs, applySplices(note.text, splices), note.bom, note.mtime);
      if (res.ok) out.fixed += splices.length;
      else out.failed.push(rel);
    }
    return out;
  }

  async trash(id: string, rels: string[]): Promise<string[]> {
    const root = this.root(id);
    if (!root || !Array.isArray(rels)) return [];
    const out: string[] = [];
    for (const rel of rels) {
      const abs = rel ? resolveInside(root, rel) : null;
      if (!abs || !fs.lstatSync(abs, { throwIfNoEntry: false })) continue;
      try {
        await this.opts.trash(abs);
        out.push(rel);
      } catch {
        // left where it was
      }
    }
    return out;
  }

  /** Undo of "new note" (only while untouched: same mtime) or "new folder" (only while empty). */
  async undoCreate(id: string, rel: string, mtime?: number): Promise<boolean> {
    const root = this.root(id);
    const abs = root && rel ? resolveInside(root, rel) : null;
    const st = abs ? fs.lstatSync(abs, { throwIfNoEntry: false }) : undefined;
    if (!abs || !st) return false;
    try {
      if (st.isDirectory()) {
        fs.rmdirSync(abs);
        return true;
      }
      if (typeof mtime !== 'number' || Math.abs(st.mtimeMs - mtime) > 1) return false;
      await this.opts.trash(abs);
      return true;
    } catch {
      return false;
    }
  }

  /** The absolute path of an existing item (for Reveal / Open in the default app), or null. */
  existing(id: string, rel: string): string | null {
    const root = this.root(id);
    const abs = root ? resolveInside(root, rel) : null;
    return abs && fs.existsSync(abs) ? abs : null;
  }

  prefs(id: string): NoteFsPrefs {
    return this.readPrefs()[String(id)] ?? EMPTY_PREFS();
  }

  setPrefs(id: string, prefs: unknown): void {
    if (typeof id !== 'string' || !id) return;
    const all = { ...this.readPrefs(), [id]: cleanPrefs(prefs) };
    try {
      fs.mkdirSync(path.dirname(this.opts.prefsFile), { recursive: true });
      const tmp = `${this.opts.prefsFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ sources: all }, null, 2) + '\n');
      fs.renameSync(tmp, this.opts.prefsFile);
    } catch {
      // not remembered
    }
  }

  private readPrefs(): Record<string, NoteFsPrefs> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.opts.prefsFile, 'utf8')) as { sources?: unknown };
      const out: Record<string, NoteFsPrefs> = {};
      if (raw.sources && typeof raw.sources === 'object')
        for (const [k, v] of Object.entries(raw.sources as Record<string, unknown>)) out[k] = cleanPrefs(v);
      return out;
    } catch {
      return {};
    }
  }
}
