// Extensions (T71): small panels the user adds as folders under ~/.aquila/extensions/<id>/ (manifest.json + HTML/JS).
// Each one runs in its own sandboxed WebContentsView (no Node, its own `aquila-ext://<id>/` origin and partition,
// deny-by-default CSP, network only to the domains it declares) and talks to us over postMessage; main answers only
// what its manifest declares. Never terminal output, never writing to a session. Local folders only, nothing bundled.
// The pure parts (manifest, permissions, CSP, request filter, paths, counts) are tested; views run only in the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow, Session as ElectronSession, WebContents, WebContentsView } from 'electron';
import type {
  AccountUsage,
  ExtensionCommand,
  ExtensionInfo,
  ExtensionPermission,
  ExtensionSystem,
  ExtensionViewState,
  PowerState,
  SessionStatus,
} from '../src/shared/api/types';

export const EXT_SCHEME = 'aquila-ext';
/** Channels of the extension preload (sandboxed: it can't import ../src, so it spells them out; a test keeps them equal). */
export const EXT_REQUEST = 'ext:request';
export const EXT_EVENT = 'ext:event';

/** Hidden views are closed after this long, unless the manifest asks `background` and the user allowed it. */
export const SUSPEND_AFTER_MS = 5 * 60 * 1000;
/** One shared `system` poll for every extension that may read it. */
export const SYSTEM_POLL_MS = 2_000;
export const SYSTEM_POLL_SAVER_MS = 10_000;
/** `storage`: per extension, JSON-encoded. */
export const STORAGE_MAX_BYTES = 512 * 1024;
/** `notify`: at most one banner per extension in this window. */
export const NOTIFY_GAP_MS = 10_000;
/** `chip.set`: short text in the sidebar. */
export const CHIP_MAX = 16;
/**
 * Injected as a *user* stylesheet (author CSS wins): a page that sets no background gets the app's canvas
 * (= --color-bg-canvas: --p-paper-0 / --p-slate-950) instead of Chromium's white / pure black, in either theme.
 */
export const BASE_CSS =
  ':root { background-color: #ffffff; } @media (prefers-color-scheme: dark) { :root { background-color: #0e1014; } }';

const PERMISSIONS: readonly ExtensionPermission[] = [
  'system',
  'sessions:status',
  'usage',
  'storage',
  'notify',
  'background',
];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A host name, or `*.` + one (any subdomain). No ports, paths or schemes. */
const DOMAIN_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface Manifest {
  id: string;
  name: string;
  description?: string;
  version?: string;
  /** One or two characters shown on the chip and in the panel picker. */
  glyph?: string;
  /** Relative path of the page, default `index.html`. */
  entry: string;
  permissions: ExtensionPermission[];
  /** `network:<domain>` entries: https only. */
  network: string[];
  commands: ExtensionCommand[];
}

export interface ParsedManifest {
  manifest: Manifest | null;
  problems: string[];
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** A relative path inside the folder: no `..`, no absolute, no backslashes. */
export function safeRelative(p: string): string | null {
  const clean = p.replace(/^\.\//, '');
  if (!clean || clean.includes('\\') || clean.includes('\0') || path.isAbsolute(clean)) return null;
  const norm = path.posix.normalize(clean);
  if (norm.startsWith('..') || norm.startsWith('/')) return null;
  return norm;
}

/**
 * `manifest.json` of folder `id`. Defensive: unknown permissions, bad domains and bad commands are dropped with a
 * problem line; a missing name or a bad folder name makes the extension unusable (`manifest: null`).
 */
export function parseManifest(text: string, id: string): ParsedManifest {
  const problems: string[] = [];
  if (!ID_RE.test(id)) return { manifest: null, problems: [`folder name "${id}": use a-z, 0-9 and -`] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { manifest: null, problems: ['manifest.json is not valid JSON'] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { manifest: null, problems: ['manifest.json must be an object'] };
  const d = data as Record<string, unknown>;
  const name = str(d.name, 40);
  if (!name) return { manifest: null, problems: ['manifest.json: "name" is missing'] };

  let entry = 'index.html';
  if (d.entry !== undefined) {
    const e = typeof d.entry === 'string' ? safeRelative(d.entry) : null;
    if (e && /\.html?$/.test(e)) entry = e;
    else problems.push(`"entry" must be an .html file inside the folder`);
  }

  const permissions: ExtensionPermission[] = [];
  const network: string[] = [];
  const raw = Array.isArray(d.permissions) ? (d.permissions as unknown[]) : [];
  if (d.permissions !== undefined && !Array.isArray(d.permissions))
    problems.push('"permissions" must be a list');
  for (const p of raw) {
    if (typeof p !== 'string') continue;
    if (p.startsWith('network:')) {
      const domain = p.slice('network:'.length).trim().toLowerCase();
      if (DOMAIN_RE.test(domain)) {
        if (!network.includes(domain)) network.push(domain);
      } else problems.push(`"${p}": a domain like api.example.com or *.example.com`);
    } else if ((PERMISSIONS as readonly string[]).includes(p)) {
      if (!permissions.includes(p as ExtensionPermission)) permissions.push(p as ExtensionPermission);
    } else problems.push(`unknown permission "${p}"`);
  }

  const commands: ExtensionCommand[] = [];
  if (Array.isArray(d.commands)) {
    for (const c of d.commands as unknown[]) {
      const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
      const cid = str(o.id, 40);
      const title = str(o.title, 60);
      if (cid && title && /^[\w.-]+$/.test(cid) && !commands.some((x) => x.id === cid))
        commands.push({ id: cid, title });
      else problems.push('a command needs a unique "id" (letters, digits, - _ .) and a "title"');
      if (commands.length >= 10) break;
    }
  }

  const glyph = str(d.glyph, 8);
  return {
    manifest: {
      id,
      name,
      description: str(d.description, 200),
      version: str(d.version, 20),
      glyph: glyph ? [...glyph].slice(0, 2).join('') : undefined,
      entry,
      permissions,
      network,
      commands,
    },
    problems,
  };
}

/** May this extension use this request method? Unknown methods are refused. */
export function methodAllowed(method: string, permissions: readonly ExtensionPermission[]): boolean {
  const need: Record<string, ExtensionPermission | null> = {
    'system.get': 'system',
    'sessions.status': 'sessions:status',
    'usage.get': 'usage',
    'storage.get': 'storage',
    'storage.set': 'storage',
    'storage.remove': 'storage',
    'storage.keys': 'storage',
    notify: 'notify',
    'chip.set': null,
    'power.get': null,
    'info.get': null,
  };
  if (!(method in need)) return false;
  const p = need[method];
  return p === null || permissions.includes(p);
}

/** Which event names an extension receives. */
export function eventAllowed(name: string, permissions: readonly ExtensionPermission[]): boolean {
  if (name === 'system') return permissions.includes('system');
  if (name === 'sessions' || name === 'waiting') return permissions.includes('sessions:status');
  if (name === 'usage') return permissions.includes('usage');
  return name === 'power' || name === 'command' || name === 'visible';
}

const hostMatches = (host: string, domain: string) =>
  domain.startsWith('*.') ? host.endsWith(domain.slice(1)) : host === domain;

/**
 * The request filter of an extension's partition: its own files, data/blob URLs, and https to its declared domains.
 * Everything else (http, other hosts, file:, other extensions) is cancelled — the CSP says the same, this holds
 * when a page navigates or something slips past it.
 */
export function requestAllowed(url: string, id: string, network: readonly string[]): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:')) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === `${EXT_SCHEME}:`) return u.hostname === id;
  if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
  if (u.port && u.port !== '443') return false;
  return network.some((d) => hostMatches(u.hostname.toLowerCase(), d));
}

/** Content-Security-Policy sent with every file of an extension. */
export function cspFor(m: Pick<Manifest, 'network'>): string {
  const net = m.network.flatMap((d) => [`https://${d}`, `wss://${d}`]).join(' ');
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${net ? ` ${m.network.map((d) => `https://${d}`).join(' ')}` : ''}`,
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src ${net || "'none'"}`,
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The file an `aquila-ext://<id>/<path>` URL maps to, or null (outside the folder, other extension, bad path). */
export function fileFor(url: string, id: string, root: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${EXT_SCHEME}:` || u.hostname !== id) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  const safe = safeRelative(rel || 'index.html');
  if (!safe) return null;
  const file = path.join(root, safe);
  return file.startsWith(root + path.sep) ? file : null;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};
export const contentType = (file: string) =>
  TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

export type StatusCounts = Record<SessionStatus, number>;

/** Sessions by status (`sessions:status` answers counts only, never which session or what it printed). */
export function statusCounts(statuses: Iterable<SessionStatus>): StatusCounts {
  const c: StatusCounts = { working: 0, waiting: 0, done: 0, error: 0, idle: 0, stopped: 0 };
  for (const s of statuses) c[s]++;
  return c;
}

export interface CpuSample {
  idle: number;
  total: number;
}

export function cpuSample(cpus: Pick<os.CpuInfo, 'times'>[] = os.cpus()): CpuSample {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Busy share of all cores between two samples, 0–100. */
export function cpuPercent(a: CpuSample, b: CpuSample): number {
  const total = b.total - a.total;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - (b.idle - a.idle) / total) * 1000) / 10));
}

/** Usage the `usage` permission sees: per account, the two windows as percent when known. */
export function usageView(list: readonly AccountUsage[]) {
  const pct = (w: AccountUsage['fiveHour']) =>
    typeof w.percent === 'number'
      ? Math.round(w.percent)
      : w.limit
        ? Math.min(100, Math.round((w.used / w.limit) * 100))
        : null;
  return list.map((u) => ({
    account: u.account,
    kind: u.kind ?? 'claude',
    fiveHour: pct(u.fiveHour),
    weekly: pct(u.weekly),
    near: u.near,
  }));
}

/** A folder name for "New extension": lower-case, dashes, unique among `taken`. */
export function slugFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'extension';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Saved choices: which extensions the user enabled (after seeing their permissions) and allowed in the background. */
export interface ExtensionPrefs {
  enabled: Record<string, boolean>;
  background: Record<string, boolean>;
}

export function parsePrefs(text: string): ExtensionPrefs {
  const prefs: ExtensionPrefs = { enabled: {}, background: {} };
  try {
    const d = JSON.parse(text) as Partial<ExtensionPrefs>;
    for (const k of ['enabled', 'background'] as const) {
      const v = d?.[k];
      if (v && typeof v === 'object')
        for (const [id, on] of Object.entries(v)) if (on === true) prefs[k][id] = true;
    }
  } catch {
    /* fresh */
  }
  return prefs;
}

// ── Runtime (Electron) ────────────────────────────────────────────────────────────────────────────────────────

/** What main hands the host (injected: keeps Electron out of the tests above). */
export interface HostDeps {
  dir: string;
  /** `<dir>/../extensions.json`-like file for prefs; storage files go in `dataDir`. */
  prefsPath: string;
  dataDir: string;
  getWindow: () => BrowserWindow | null;
  electron: {
    WebContentsView: typeof WebContentsView;
    fromPartition: (partition: string) => ElectronSession;
  };
  preload: string;
  power: () => PowerState;
  usage: () => Promise<AccountUsage[]>;
  notify: (title: string, body: string) => void;
  /** The renderer's list changed (install, enable, chip text). */
  onChanged: (list: ExtensionInfo[]) => void;
}

interface Entry {
  manifest: Manifest | null;
  problems: string[];
  dir: string;
}

interface Live {
  id: string;
  view: WebContentsView;
  visible: boolean;
  hiddenAt: number;
  bounds: ExtensionViewState['bounds'];
}

/** The extensions, their views and the API they call. One per app. */
export class ExtensionHost {
  private entries = new Map<string, Entry>();
  private prefs: ExtensionPrefs;
  private live = new Map<string, Live>();
  /** webContents id → extension id: requests are attributed by sender, never by what the page says. */
  private byContents = new Map<number, string>();
  private sessionsReady = new Set<string>();
  private chips = new Map<string, string>();
  private lastNotify = new Map<string, number>();
  private statuses = new Map<string, SessionStatus>();
  private countsTimer: NodeJS.Timeout | undefined;
  private lastCounts = '';
  private pollTimer: NodeJS.Timeout | undefined;
  private suspendTimer: NodeJS.Timeout | undefined;
  private cpuPrev = cpuSample();
  private lastSystem: ExtensionSystem | null = null;
  private watcher: fs.FSWatcher | null = null;
  private rescanTimer: NodeJS.Timeout | undefined;

  constructor(private deps: HostDeps) {
    let text = '';
    try {
      text = fs.readFileSync(deps.prefsPath, 'utf8');
    } catch {
      /* none yet */
    }
    this.prefs = parsePrefs(text);
    this.scan();
  }

  // ── Folder ──

  /** Re-reads every `<dir>/<id>/manifest.json`. */
  scan(): void {
    const next = new Map<string, Entry>();
    let names: string[] = [];
    try {
      names = fs
        .readdirSync(this.deps.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort();
    } catch {
      /* no folder yet */
    }
    for (const id of names) {
      const dir = path.join(this.deps.dir, id);
      let text: string;
      try {
        text = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
      } catch {
        next.set(id, { manifest: null, problems: ['manifest.json is missing'], dir });
        continue;
      }
      const { manifest, problems } = parseManifest(text, id);
      if (manifest && !fs.existsSync(path.join(dir, manifest.entry)))
        next.set(id, { manifest: null, problems: [`${manifest.entry} is missing`, ...problems], dir });
      else next.set(id, { manifest, problems, dir });
    }
    this.entries = next;
    // Gone or no longer usable: close its view.
    for (const id of [...this.live.keys()]) if (!this.usable(id)) this.close(id);
  }

  /** Watches the folder (top level only) so a new or removed extension shows up without a restart. */
  watch(): void {
    if (this.watcher) return;
    try {
      fs.mkdirSync(this.deps.dir, { recursive: true });
      this.watcher = fs.watch(this.deps.dir, () => {
        clearTimeout(this.rescanTimer);
        this.rescanTimer = setTimeout(() => {
          this.scan();
          this.changed();
        }, 500);
      });
      this.watcher.on('error', () => undefined);
    } catch {
      /* no watch: the panel's Reload rescans */
    }
  }

  list(): ExtensionInfo[] {
    return [...this.entries.entries()].map(([id, e]) => {
      const m = e.manifest;
      return {
        id,
        name: m?.name ?? id,
        description: m?.description,
        version: m?.version,
        glyph: m?.glyph,
        dir: e.dir,
        valid: !!m,
        problems: e.problems,
        permissions: m?.permissions ?? [],
        network: m?.network ?? [],
        commands: m?.commands ?? [],
        enabled: !!m && !!this.prefs.enabled[id],
        background: !!this.prefs.background[id],
        running: this.live.has(id),
        chip: this.chips.get(id),
      };
    });
  }

  private usable(id: string): Manifest | null {
    const m = this.entries.get(id)?.manifest;
    return m && this.prefs.enabled[id] ? m : null;
  }

  private savePrefs(): void {
    try {
      fs.mkdirSync(path.dirname(this.deps.prefsPath), { recursive: true });
      fs.writeFileSync(this.deps.prefsPath, JSON.stringify(this.prefs, null, 2));
    } catch (err) {
      console.error('[extensions] prefs not saved', err);
    }
  }

  private changed(): void {
    this.deps.onChanged(this.list());
  }

  setEnabled(id: string, on: boolean): ExtensionInfo[] {
    if (!this.entries.get(id)?.manifest) return this.list();
    if (on) this.prefs.enabled[id] = true;
    else {
      delete this.prefs.enabled[id];
      delete this.prefs.background[id];
      this.close(id);
      this.chips.delete(id);
    }
    this.savePrefs();
    this.changed();
    return this.list();
  }

  setBackground(id: string, on: boolean): ExtensionInfo[] {
    const m = this.usable(id);
    if (on && m?.permissions.includes('background')) this.prefs.background[id] = true;
    else delete this.prefs.background[id];
    this.savePrefs();
    this.scheduleSuspend();
    this.changed();
    return this.list();
  }

  /** Starts the extensions the user allowed to run in the background (at launch). */
  startBackground(): void {
    for (const id of this.entries.keys()) {
      const m = this.usable(id);
      if (m?.permissions.includes('background') && this.prefs.background[id] && !this.live.has(id))
        this.open(id, m, false);
    }
  }

  // ── Views ──

  /** Shows the panel's extension over the stage rect; null hides it (and starts the suspend clock). */
  show(id: string, state: ExtensionViewState | null): void {
    const m = this.usable(id);
    if (!m) return;
    let l = this.live.get(id);
    if (!state) {
      if (l?.visible) this.setVisible(l, false);
      return;
    }
    if (!l) l = this.open(id, m, true);
    if (!l) return;
    const r = (n: number) => Math.max(0, Math.round(n));
    l.bounds = {
      x: r(state.bounds.x),
      y: r(state.bounds.y),
      width: r(state.bounds.width),
      height: r(state.bounds.height),
    };
    l.view.setBounds(l.bounds);
    this.setVisible(l, !state.hidden && l.bounds.width > 0 && l.bounds.height > 0);
  }

  /** Every view hidden (the panel closed, another extension picked). */
  hideAll(except?: string): void {
    for (const l of this.live.values()) if (l.id !== except && l.visible) this.setVisible(l, false);
  }

  reload(id: string): void {
    this.scan();
    const l = this.live.get(id);
    if (l) {
      // Manifest may have changed (permissions, CSP): a fresh view picks it up.
      const visible = l.visible;
      const bounds = l.bounds;
      this.close(id);
      const m = this.usable(id);
      if (m && visible) this.show(id, { bounds, hidden: false });
    }
    this.changed();
  }

  command(id: string, commandId: string): void {
    const m = this.usable(id);
    if (!m?.commands.some((c) => c.id === commandId)) return;
    const l = this.live.get(id) ?? this.open(id, m, false);
    if (!l) return;
    const wc = l.view.webContents;
    const fire = () => this.emitTo(id, 'command', { id: commandId });
    if (wc.isLoading()) wc.once('did-finish-load', fire);
    else fire();
  }

  /** Native views over the page (capture composites them; smoke reads them). */
  visibleViews() {
    return [...this.live.values()]
      .filter((l) => l.visible)
      .map((l) => ({ id: l.id, bounds: l.bounds, webContents: l.view.webContents }));
  }

  contentsOf(id: string): WebContents | null {
    return this.live.get(id)?.view.webContents ?? null;
  }

  destroyAll(): void {
    for (const id of [...this.live.keys()]) this.close(id);
  }

  dispose(): void {
    this.destroyAll();
    clearInterval(this.pollTimer);
    clearTimeout(this.suspendTimer);
    clearTimeout(this.countsTimer);
    clearTimeout(this.rescanTimer);
    this.watcher?.close();
  }

  private setVisible(l: Live, visible: boolean): void {
    if (l.visible === visible) return;
    l.visible = visible;
    l.view.setVisible(visible);
    // Hidden: Chromium throttles its timers; the page hears it so it can pause too.
    l.view.webContents.setBackgroundThrottling(true);
    if (!visible) l.hiddenAt = Date.now();
    this.emitTo(l.id, 'visible', { visible });
    this.scheduleSuspend();
  }

  private ensureSession(id: string): ElectronSession {
    const ses = this.deps.electron.fromPartition(`persist:aquila-ext-${id}`);
    if (this.sessionsReady.has(id)) return ses;
    this.sessionsReady.add(id);
    const entry = () => this.entries.get(id);
    ses.protocol.handle(EXT_SCHEME, async (req) => {
      const e = entry();
      const man = e?.manifest;
      const file = e && man ? fileFor(req.url, id, e.dir) : null;
      if (!file || !man) return new Response('Not found', { status: 404 });
      try {
        // Resolved again so a symlink can't lead out of the folder.
        const real = fs.realpathSync(file);
        const root = fs.realpathSync(e.dir);
        if (!real.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
        const body = await fs.promises.readFile(real);
        return new Response(body, {
          headers: {
            'content-type': contentType(real),
            'content-security-policy': cspFor(man),
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    ses.webRequest.onBeforeRequest((details, cb) => {
      const man = entry()?.manifest;
      cb({ cancel: !man || !requestAllowed(details.url, id, man.network) });
    });
    ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    return ses;
  }

  private open(id: string, m: Manifest, visible: boolean): Live | undefined {
    const win = this.deps.getWindow();
    if (!win) return undefined;
    const ses = this.ensureSession(id);
    const view = new this.deps.electron.WebContentsView({
      webPreferences: {
        session: ses,
        preload: this.deps.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        backgroundThrottling: true,
      },
    });
    const wc = view.webContents;
    const origin = `${EXT_SCHEME}://${id}/`;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const stay = (e: { preventDefault: () => void }, url: string) => {
      if (!url.startsWith(origin)) e.preventDefault();
    };
    wc.on('will-navigate', (e) => stay(e, e.url));
    wc.on('will-redirect', (e) => stay(e, e.url));
    wc.on('will-attach-webview', (e) => e.preventDefault());
    wc.on('render-process-gone', () => this.close(id));
    wc.on('dom-ready', () => void wc.insertCSS(BASE_CSS, { cssOrigin: 'user' }).catch(() => undefined));
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    win.contentView.addChildView(view);
    const l: Live = {
      id,
      view,
      visible: false,
      hiddenAt: Date.now(),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
    this.live.set(id, l);
    this.byContents.set(wc.id, id);
    void wc.loadURL(`${origin}${m.entry}`).catch(() => undefined);
    if (visible) this.setVisible(l, true);
    this.ensurePoll();
    this.scheduleSuspend();
    this.changed();
    return l;
  }

  private close(id: string): void {
    const l = this.live.get(id);
    if (!l) return;
    this.live.delete(id);
    const wc = l.view.webContents;
    this.byContents.delete(wc.id);
    const win = this.deps.getWindow();
    try {
      win?.contentView.removeChildView(l.view);
    } catch {
      /* window gone */
    }
    if (!wc.isDestroyed()) wc.close();
    this.ensurePoll();
    this.changed();
  }

  /** Closes views hidden for SUSPEND_AFTER_MS that may not run in the background; re-arms for the next one. */
  private scheduleSuspend(): void {
    clearTimeout(this.suspendTimer);
    const now = Date.now();
    let next = Infinity;
    for (const l of [...this.live.values()]) {
      if (l.visible || this.prefs.background[l.id]) continue;
      const due = l.hiddenAt + SUSPEND_AFTER_MS;
      if (due <= now) this.close(l.id);
      else next = Math.min(next, due);
    }
    if (next < Infinity) this.suspendTimer = setTimeout(() => this.scheduleSuspend(), next - now + 50);
  }

  // ── Shared feeds ──

  private ensurePoll(): void {
    const wanted = [...this.live.keys()].some((id) => this.usable(id)?.permissions.includes('system'));
    if (!wanted) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      return;
    }
    if (this.pollTimer) return;
    this.restartPoll();
  }

  /** Power saver changed: slower poll, and every extension hears it. */
  powerChanged(p: PowerState): void {
    this.broadcast('power', { saver: p.saver, onBattery: p.onBattery });
    if (this.pollTimer) this.restartPoll();
  }

  private restartPoll(): void {
    clearInterval(this.pollTimer);
    const ms = this.deps.power().saver ? SYSTEM_POLL_SAVER_MS : SYSTEM_POLL_MS;
    this.pollTimer = setInterval(() => this.broadcast('system', this.system()), ms);
  }

  system(): ExtensionSystem {
    const sample = cpuSample();
    const cpu = cpuPercent(this.cpuPrev, sample);
    this.cpuPrev = sample;
    const total = os.totalmem();
    const p = this.deps.power();
    const app = process.memoryUsage().rss;
    this.lastSystem = {
      cpu,
      cores: os.cpus().length,
      load: Math.round(os.loadavg()[0] * 100) / 100,
      memory: { used: total - os.freemem(), total },
      appMemory: app,
      onBattery: p.onBattery,
      saver: p.saver,
      at: Date.now(),
    };
    return this.lastSystem;
  }

  sessionStatus(id: string, status: SessionStatus): void {
    const before = this.statuses.get(id);
    this.statuses.set(id, status);
    if (status === 'waiting' && before !== 'waiting')
      this.broadcast('waiting', { count: [...this.statuses.values()].filter((s) => s === 'waiting').length });
    this.countsSoon();
  }

  sessionEnded(id: string): void {
    if (this.statuses.delete(id)) this.countsSoon();
  }

  private counts() {
    const counts = statusCounts(this.statuses.values());
    return { counts, total: this.statuses.size };
  }

  private countsSoon(): void {
    if (this.countsTimer) return;
    this.countsTimer = setTimeout(() => {
      this.countsTimer = undefined;
      const c = this.counts();
      const key = JSON.stringify(c);
      if (key === this.lastCounts) return;
      this.lastCounts = key;
      this.broadcast('sessions', c);
    }, 250);
  }

  usageChanged(list: AccountUsage[]): void {
    this.broadcast('usage', usageView(list));
  }

  private broadcast(name: string, data: unknown): void {
    for (const id of this.live.keys()) this.emitTo(id, name, data);
  }

  private emitTo(id: string, name: string, data: unknown): void {
    const m = this.usable(id);
    const wc = this.live.get(id)?.view.webContents;
    if (!m || !wc || wc.isDestroyed() || !eventAllowed(name, m.permissions)) return;
    wc.send(EXT_EVENT, name, data);
  }

  // ── Requests ──

  /** `ext:request` from a view. The sender decides which extension it is; the manifest decides what it may do. */
  async request(sender: WebContents, method: unknown, params: unknown): Promise<unknown> {
    const id = this.byContents.get(sender.id);
    const m = id ? this.usable(id) : null;
    if (!id || !m) throw new Error('not an extension');
    if (typeof method !== 'string' || !methodAllowed(method, m.permissions))
      throw new Error(`not allowed: ${String(method)} (add the permission to manifest.json)`);
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
    switch (method) {
      case 'info.get':
        return {
          id,
          name: m.name,
          version: m.version,
          permissions: m.permissions,
          network: m.network,
        };
      case 'power.get': {
        const pw = this.deps.power();
        return { saver: pw.saver, onBattery: pw.onBattery };
      }
      case 'system.get':
        return this.lastSystem && Date.now() - this.lastSystem.at < 1000 ? this.lastSystem : this.system();
      case 'sessions.status':
        return this.counts();
      case 'usage.get':
        return usageView(await this.deps.usage());
      case 'storage.get':
        return this.storage(id)[String(p.key)] ?? null;
      case 'storage.keys':
        return Object.keys(this.storage(id));
      case 'storage.set':
      case 'storage.remove': {
        const key = String(p.key ?? '');
        if (!key || key.length > 200) throw new Error('storage: key must be 1–200 characters');
        const data = this.storage(id);
        if (method === 'storage.remove') delete data[key];
        else data[key] = p.value === undefined ? null : p.value;
        const text = JSON.stringify(data);
        if (Buffer.byteLength(text) > STORAGE_MAX_BYTES) throw new Error('storage: over 512 KB');
        fs.mkdirSync(this.deps.dataDir, { recursive: true });
        fs.writeFileSync(this.storageFile(id), text);
        return true;
      }
      case 'notify': {
        const now = Date.now();
        if (now - (this.lastNotify.get(id) ?? 0) < NOTIFY_GAP_MS) return false;
        this.lastNotify.set(id, now);
        const title = typeof p.title === 'string' ? p.title.slice(0, 80) : '';
        const body = typeof p.body === 'string' ? p.body.slice(0, 200) : '';
        this.deps.notify(title ? `${m.name} · ${title}` : m.name, body);
        return true;
      }
      case 'chip.set': {
        const text = typeof p.text === 'string' ? p.text.trim().slice(0, CHIP_MAX) : '';
        if ((this.chips.get(id) ?? '') === text) return true;
        if (text) this.chips.set(id, text);
        else this.chips.delete(id);
        this.changed();
        return true;
      }
    }
    throw new Error(`not allowed: ${method}`);
  }

  private storageFile(id: string): string {
    return path.join(this.deps.dataDir, `${id}.json`);
  }

  private storage(id: string): Record<string, unknown> {
    try {
      const d = JSON.parse(fs.readFileSync(this.storageFile(id), 'utf8')) as unknown;
      return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  // ── New extension ──

  /** A new folder from the template (manifest, page, client, AGENTS.md for the agent that writes it). */
  create(name: string): { id: string; dir: string } {
    fs.mkdirSync(this.deps.dir, { recursive: true });
    let taken: Set<string>;
    try {
      taken = new Set(fs.readdirSync(this.deps.dir));
    } catch {
      taken = new Set();
    }
    const id = slugFor(name, taken);
    const dir = path.join(this.deps.dir, id);
    fs.mkdirSync(dir);
    for (const [file, text] of Object.entries(templateFiles(id, name.trim() || id)))
      fs.writeFileSync(path.join(dir, file), text);
    // The user made it here (template permissions only): no review needed. A later manifest change asks again only
    // if they disable it.
    this.prefs.enabled[id] = true;
    this.savePrefs();
    this.scan();
    this.changed();
    return { id, dir };
  }
}

// ── Template ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The small client every page can include: `<script src="aquila.js"></script>` → `window.aquila`. */
export const CLIENT_JS = `// Aquila extension client. Include it with <script src="aquila.js"></script>; then use window.aquila.
// Talks to Aquila over window.postMessage. Every call returns a Promise; refused calls reject with the reason.
(() => {
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || typeof m !== 'object') return;
    if (m.aquila === 'response' && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if ('error' in m) reject(new Error(m.error));
      else resolve(m.result);
    } else if (m.aquila === 'event') {
      for (const cb of listeners.get(m.name) || []) cb(m.data);
    }
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ aquila: 'request', id, method, params }, location.origin);
    });
  const on = (name, cb) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(cb);
    return () => listeners.get(name).delete(cb);
  };
  window.aquila = {
    call,
    on,
    info: () => call('info.get'),
    power: () => call('power.get'),
    system: () => call('system.get'),
    sessions: () => call('sessions.status'),
    usage: () => call('usage.get'),
    storage: {
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
      remove: (key) => call('storage.remove', { key }),
      keys: () => call('storage.keys'),
    },
    notify: (title, body) => call('notify', { title, body }),
    chip: (text) => call('chip.set', { text }),
  };
})();
`;

export function templateFiles(id: string, name: string): Record<string, string> {
  const manifest = {
    name,
    description: '',
    version: '0.1.0',
    glyph: '◇',
    entry: 'index.html',
    permissions: ['system'],
    commands: [],
  };
  return {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'aquila.js': CLIENT_JS,
    'index.html': `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name.replace(/</g, '&lt;')}</title>
    <style>
      :root { color-scheme: light dark; font: 13px/1.5 -apple-system, system-ui, sans-serif; }
      body { margin: 0; padding: 16px; }
    </style>
    <script src="aquila.js"></script>
  </head>
  <body>
    <p id="cpu">…</p>
    <script>
      const show = (s) => (document.getElementById('cpu').textContent = 'CPU ' + s.cpu + '%');
      aquila.system().then(show);
      aquila.on('system', show);
    </script>
  </body>
</html>
`,
    'AGENTS.md': agentsMd(id),
    'CLAUDE.md': '@AGENTS.md\n',
  };
}

function agentsMd(id: string): string {
  return `# Aquila extension \`${id}\`

A small panel that runs inside Aquila (a macOS app for terminal agent sessions). Plain HTML/CSS/JS in this folder —
no build step, no Node, no npm packages at runtime. Aquila shows \`entry\` in its right panel; reload it with the
panel's ↻ button after editing.

## Files

- \`manifest.json\` — name, permissions, commands (below).
- \`index.html\` — the page (\`entry\`). Other files load by relative path (\`./app.js\`, \`./style.css\`).
- \`aquila.js\` — the client; include it with \`<script src="aquila.js"></script>\`. Don't edit it.

## manifest.json

\`\`\`json
{
  "name": "Shown in the panel and ⌘K",
  "description": "One line",
  "version": "0.1.0",
  "glyph": "◇",
  "entry": "index.html",
  "permissions": ["system", "sessions:status", "usage", "storage", "notify", "background", "network:api.example.com"],
  "commands": [{ "id": "start", "title": "Start timer" }]
}
\`\`\`

Ask only for what the page uses: the user sees the list before enabling it, and a changed list needs a reload.

| Permission | Gives |
|---|---|
| \`system\` | \`aquila.system()\` and the \`system\` event: \`{ cpu, cores, load, memory: { used, total }, appMemory, onBattery, saver, at }\` (cpu in %, bytes) |
| \`sessions:status\` | \`aquila.sessions()\` and the \`sessions\` event: \`{ counts: { working, waiting, done, error, idle, stopped }, total }\`; the \`waiting\` event \`{ count }\` when a session starts waiting |
| \`usage\` | \`aquila.usage()\` and the \`usage\` event: \`[{ account, kind, fiveHour, weekly, near }]\` (percent or null) |
| \`storage\` | \`aquila.storage.get/set/remove/keys\` — JSON values, 512 KB in all |
| \`notify\` | \`aquila.notify(title, body)\` — a macOS banner, at most one per 10 s |
| \`background\` | may keep running while the panel is closed, if the user allows it; otherwise a hidden page is closed after 5 minutes |
| \`network:<domain>\` | \`fetch\`/WebSocket to \`https://<domain>\` (\`*.example.com\` for subdomains). Nothing else reaches the network |

Always available: \`aquila.info()\`, \`aquila.power()\` (\`{ saver, onBattery }\`), \`aquila.chip(text)\` (up to 16
characters shown in the sidebar; \`''\` clears it), and the events \`power\`, \`visible\` (\`{ visible }\`) and \`command\`
(\`{ id }\` of a manifest command run from ⌘K).

\`\`\`js
aquila.on('system', (s) => render(s));
aquila.on('power', ({ saver }) => slowDown(saver));
aquila.on('command', ({ id }) => id === 'start' && start());
\`\`\`

## Rules

- There is no access to terminal output, prompts or session contents, and no way to type into a session.
- The CSP allows scripts and styles from this folder (inline too), images from here, \`data:\` and the declared domains.
  No other origins, no iframes, no popups, no downloads, no camera/microphone/location/clipboard permissions.
- Be light: stop timers and animations on \`visible: false\` and in power saver; no busy loops.
- Follow the system colour scheme (\`color-scheme: light dark\`), keep text 12–14 px, padding 16 px.
`;
}
