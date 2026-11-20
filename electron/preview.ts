// In-app preview (T33): find the project's dev server, show it in a native WebContentsView over the panel's stage,
// and let the user pick an element (selector, text, computed style, component name, a cropped screenshot).
// The pure parts (launch.json, address scan, fit) are tested; the view and the pick script run only in the app.
import fs from 'node:fs';
import path from 'node:path';
import { WebContentsView, type BrowserWindow } from 'electron';
import type {
  PickResult,
  PreviewCommand,
  PreviewNav,
  PreviewRect,
  PreviewSlot,
  PreviewState,
} from '../src/shared/api/types';
import { PASTE_DIR, prunePasteDir } from './terminalHelpers';

/** Addresses kept per project (most recent first). */
const MAX_URLS = 5;
/** Output kept per session so an address split across two pty chunks is still found. */
const TAIL = 256;
const PICK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Context around the picked element in the screenshot (CSS px). */
const PICK_MARGIN = 8;

/**
 * `.claude/launch.json` (Claude Code's preview config): `{ configurations: [{ name, port?, url? }] }`. Defensive —
 * anything unexpected yields nothing.
 */
export function parseLaunchJson(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const configs = (data as { configurations?: unknown } | null)?.configurations;
  if (!Array.isArray(configs)) return [];
  const urls: string[] = [];
  for (const c of configs as unknown[]) {
    if (!c || typeof c !== 'object') continue;
    const { url, port } = c as { url?: unknown; port?: unknown };
    const u =
      typeof url === 'string' && /^https?:\/\//.test(url)
        ? normalizeUrl(url)
        : typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536
          ? `http://localhost:${port}/`
          : null;
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

export function readLaunchJson(projectDir: string): string[] {
  try {
    return parseLaunchJson(fs.readFileSync(path.join(projectDir, '.claude', 'launch.json'), 'utf8'));
  } catch {
    return [];
  }
}

// eslint-disable-next-line no-control-regex -- terminal escapes are control characters
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s'"<>`)\]]*)?/g;

/** `0.0.0.0` / `127.0.0.1` / `[::1]` → localhost, trailing punctuation dropped, always a path. */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.replace(/[.,;:!?]+$/, ''));
  } catch {
    return raw;
  }
  if (['0.0.0.0', '127.0.0.1', '[::1]', '[::]'].includes(u.hostname)) u.hostname = 'localhost';
  return u.toString();
}

/**
 * A dev server announces itself at its root or a base path (`/`, `/app/`); deeper paths are request logs and API
 * calls (`GET http://localhost:8080/api/home/today`), not pages to preview.
 */
const isServerAddress = (url: string): boolean => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length <= 1;
  } catch {
    return false;
  }
};

/** Local dev-server addresses in a piece of terminal output (colors stripped: Vite bolds the port). */
export function findDevUrls(text: string, ignorePorts: readonly number[] = []): string[] {
  const plain = text.replace(ANSI, '');
  const out: string[] = [];
  for (const m of plain.matchAll(LOCAL_URL)) {
    const port = Number(m[1]);
    if (port < 1 || port > 65535 || ignorePorts.includes(port)) continue;
    const u = normalizeUrl(m[0]);
    if (!isServerAddress(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** Addresses seen in each project's terminals, most recent first. Cheap on floods: no `://`, no regex. */
export class DevUrlTracker {
  private tails = new Map<string, string>();
  private byProject = new Map<string, string[]>();

  constructor(
    private onChange: (projectId: string, urls: string[]) => void,
    private ignorePorts: readonly number[] = [],
  ) {}

  feed(projectId: string, sessionId: string, data: string): void {
    const text = (this.tails.get(sessionId) ?? '') + data;
    this.tails.set(sessionId, text.slice(-TAIL));
    if (!text.includes('://')) return;
    const found = findDevUrls(text, this.ignorePorts);
    if (!found.length) return;
    const before = this.byProject.get(projectId) ?? [];
    // The last address printed is the freshest (a restarted server on a new port).
    const next = [...found.reverse(), ...before.filter((u) => !found.includes(u))].slice(0, MAX_URLS);
    if (next.join('\n') === before.join('\n')) return;
    this.byProject.set(projectId, next);
    this.onChange(projectId, next);
  }

  forgetSession(sessionId: string): void {
    this.tails.delete(sessionId);
  }

  urls(projectId: string): string[] {
    return this.byProject.get(projectId) ?? [];
  }
}

/** launch.json first (the user said so), then what the terminals printed. */
export const mergeTargets = (launch: readonly string[], seen: readonly string[]): string[] => [
  ...new Set([...launch, ...seen]),
];

/**
 * Where the native view goes inside the stage and its zoom: a preset narrower than the stage is centred at 1×, a
 * wider one fills the stage zoomed out so the page still lays out at the preset's CSS width.
 */
export function fitView(stage: PreviewRect, width: number): { bounds: PreviewRect; zoom: number } {
  const r = (n: number) => Math.max(0, Math.round(n));
  const sw = r(stage.width);
  if (!width || width >= sw) {
    const zoom = width ? Math.max(0.25, sw / width) : 1;
    return { bounds: { x: r(stage.x), y: r(stage.y), width: sw, height: r(stage.height) }, zoom };
  }
  return {
    bounds: { x: r(stage.x + (sw - width) / 2), y: r(stage.y), width: r(width), height: r(stage.height) },
    zoom: 1,
  };
}

/** The element's rect (CSS px) with a margin, scaled to the view and clamped to it — for `capturePage`. */
export function cropRect(
  rect: PreviewRect,
  zoom: number,
  view: { width: number; height: number },
): PreviewRect | null {
  const x = Math.max(0, Math.floor((rect.x - PICK_MARGIN) * zoom));
  const y = Math.max(0, Math.floor((rect.y - PICK_MARGIN) * zoom));
  const right = Math.min(view.width, Math.ceil((rect.x + rect.width + PICK_MARGIN) * zoom));
  const bottom = Math.min(view.height, Math.ceil((rect.y + rect.height + PICK_MARGIN) * zoom));
  if (right - x < 2 || bottom - y < 2) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Runs in the previewed page (no Node, isolated world not needed: it only reads the DOM). Resolves with what the
 * user clicked, or null on Esc / `window.__aquilaPick.cancel()`. The highlight is removed two frames before
 * resolving so the screenshot doesn't show it.
 */
export const PICK_SCRIPT = String.raw`(() => new Promise((resolve) => {
  if (window.__aquilaPick) window.__aquilaPick.cancel();
  const accent = '#4c8dff';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:2px solid ' + accent + ';background:rgba(76,141,255,.12);border-radius:2px;display:none';
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;font:12px/1.6 ui-monospace,Menlo,monospace;color:#fff;background:' + accent + ';padding:0 6px;border-radius:2px;white-space:nowrap;display:none';
  document.documentElement.append(box, tip);
  const cursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';
  let cur = null;
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
  const place = (el) => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    tip.textContent = label(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    Object.assign(tip.style, { display: 'block', left: Math.max(0, r.left) + 'px', top: (r.top > 20 ? r.top - 20 : r.bottom + 2) + 'px' });
  };
  const move = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === tip || el === cur) return;
    cur = el;
    place(el);
  };
  const block = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const click = (e) => { block(e); done(describe(cur || e.target)); };
  const key = (e) => { if (e.key === 'Escape') { block(e); done(null); } };
  const events = [['mousemove', move], ['click', click], ['mousedown', block], ['mouseup', block], ['pointerdown', block], ['pointerup', block], ['keydown', key]];
  events.forEach(([t, f]) => window.addEventListener(t, f, true));

  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const part = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && unique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    const test = el.getAttribute('data-testid');
    if (test) return tag + '[data-testid="' + test.replace(/"/g, '\\"') + '"]';
    let s = tag + [...el.classList].filter((c) => !/^(css|sc|jsx|svelte)-|\d{3,}/.test(c)).slice(0, 3).map((c) => '.' + CSS.escape(c)).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
    }
    return s;
  };
  const selectorOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      parts.unshift(part(n));
      const sel = parts.join(' > ');
      if (parts[0].startsWith('#') || unique(sel)) return sel;
    }
    return parts.join(' > ');
  };
  const KEEP = ['role', 'aria-label', 'data-testid', 'name', 'type', 'href', 'src', 'alt', 'placeholder', 'title'];
  const STYLES = ['display', 'position', 'width', 'height', 'margin', 'padding', 'gap', 'color', 'background-color',
    'background-image', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
    'border', 'border-radius', 'box-shadow', 'opacity', 'flex-direction', 'align-items', 'justify-content'];
  const DEFAULTS = ['none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'static', '0px none rgb(0, 0, 0)', 'start'];
  const components = (el) => {
    const names = [];
    let source;
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    for (let f = fiberKey ? el[fiberKey] : null; f && names.length < 3; f = f.return) {
      const t = f.type;
      const name = t && typeof t !== 'string' && (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)));
      if (name && name.length > 1 && !names.includes(name)) {
        names.push(name);
        if (!source && f._debugSource) source = f._debugSource.fileName + ':' + f._debugSource.lineNumber;
      }
    }
    for (let n = el; n && !names.length; n = n.parentElement) {
      const vue = n.__vueParentComponent;
      for (let c = vue; c && names.length < 3; c = c.parent) {
        const name = c.type && (c.type.name || c.type.__name);
        if (name && !names.includes(name)) names.push(name);
        if (!source && c.type && c.type.__file) source = c.type.__file;
      }
    }
    return { names, source };
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of STYLES) {
      const v = cs.getPropertyValue(p);
      if (v && !DEFAULTS.includes(v)) styles[p] = v;
    }
    const attrs = {};
    for (const a of KEEP) {
      const v = el.getAttribute(a);
      if (v) attrs[a] = v.slice(0, 200);
    }
    const { names, source } = components(el);
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    return {
      url: location.href,
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
      attrs,
      components: names,
      source,
      styles,
      rect: { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y },
    };
  };
  let finished = false;
  const done = (value) => {
    if (finished) return;
    finished = true;
    events.forEach(([t, f]) => window.removeEventListener(t, f, true));
    box.remove();
    tip.remove();
    document.documentElement.style.cursor = cursor;
    delete window.__aquilaPick;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
  };
  window.__aquilaPick = { cancel: () => done(null) };
}))()`;

const stamp = (d: Date) => d.toISOString().replace(/\D/g, '').slice(0, 14);

interface SlotView {
  view: WebContentsView;
  url: string;
  width: number;
  zoom: number;
  bounds: PreviewRect;
  error?: string;
  errorUrl?: string;
}

/**
 * The native views, one per slot. Created on first show, destroyed when the panel closes (null state). A separate
 * persistent partition keeps the previewed app's cookies (and a Figma login) away from ours.
 */
export class PreviewViews {
  private slots = new Map<PreviewSlot, SlotView>();

  constructor(
    private getWindow: () => BrowserWindow | null,
    private sendNav: (nav: PreviewNav) => void,
    private openExternal: (url: string) => void,
  ) {}

  set(slot: PreviewSlot, state: PreviewState | null): void {
    const win = this.getWindow();
    if (!win) return;
    let s = this.slots.get(slot);
    if (!state) {
      if (s) this.destroy(slot, s, win);
      return;
    }
    if (!s) {
      s = this.create(slot, win);
      this.slots.set(slot, s);
    }
    const { bounds, zoom } = fitView(state.bounds, state.width);
    s.bounds = bounds;
    s.width = state.width;
    s.view.setBounds(bounds);
    s.view.setVisible(!state.hidden && bounds.width > 0 && bounds.height > 0);
    if (zoom !== s.zoom) {
      s.zoom = zoom;
      s.view.webContents.setZoomFactor(zoom);
    }
    if (state.url && state.url !== s.url) {
      s.url = state.url;
      s.error = undefined;
      s.errorUrl = undefined;
      void s.view.webContents.loadURL(state.url).catch(() => {
        /* reported by did-fail-load */
      });
    }
  }

  command(slot: PreviewSlot, command: PreviewCommand): void {
    const wc = this.slots.get(slot)?.view.webContents;
    if (!wc) return;
    if (command === 'reload') wc.reload();
    else if (command === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (command === 'devtools') wc.openDevTools({ mode: 'detach' });
  }

  async pick(slot: PreviewSlot): Promise<PickResult | null> {
    const s = this.slots.get(slot);
    if (!s) return null;
    const wc = s.view.webContents;
    wc.focus();
    let picked: PickResult | null;
    try {
      picked = (await wc.executeJavaScript(PICK_SCRIPT, true)) as PickResult | null;
    } catch {
      return null;
    }
    this.getWindow()?.webContents.focus();
    if (!picked) return null;
    const rect = cropRect(picked.rect, s.zoom, s.bounds);
    if (rect) {
      try {
        const png = (await wc.capturePage(rect)).toPNG();
        if (png.length) {
          const now = new Date();
          prunePasteDir(PASTE_DIR, PICK_MAX_AGE_MS, now.getTime());
          fs.mkdirSync(PASTE_DIR, { recursive: true });
          const file = path.join(PASTE_DIR, `pick-${stamp(now)}-${now.getMilliseconds()}.png`);
          fs.writeFileSync(file, png);
          picked.imagePath = file;
        }
      } catch (err) {
        console.error('[preview] capture failed', err);
      }
    }
    return picked;
  }

  cancelPick(slot: PreviewSlot): void {
    void this.slots
      .get(slot)
      ?.view.webContents.executeJavaScript('window.__aquilaPick && window.__aquilaPick.cancel()')
      .catch(() => undefined);
  }

  /** Views on screen with their bounds (capture composites them into its frames: they're not in the page). */
  visible(): { bounds: PreviewRect; capture: (rect?: PreviewRect) => Promise<Electron.NativeImage> }[] {
    return [...this.slots.values()]
      .filter((s) => s.view.getVisible())
      .map((s) => ({ bounds: s.bounds, capture: (rect) => s.view.webContents.capturePage(rect) }));
  }

  /**
   * Mouse move onto an element of a view, and a click with `click` (capture: Select mode's highlight; smoke: a pick).
   * False when it isn't there.
   */
  async hover(slot: PreviewSlot, selector: string, click = false): Promise<boolean> {
    const s = this.slots.get(slot);
    if (!s) return false;
    const at = (await s.view.webContents.executeJavaScript(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`)) as { x: number; y: number } | null;
    if (!at) return false;
    const x = Math.round(at.x * s.zoom);
    const y = Math.round(at.y * s.zoom);
    const wc = s.view.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    if (click)
      for (const type of ['mouseDown', 'mouseUp'] as const)
        wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    return true;
  }

  destroyAll(): void {
    const win = this.getWindow();
    for (const [slot, s] of this.slots) {
      if (win) this.destroy(slot, s, win);
      else s.view.webContents.close();
    }
    this.slots.clear();
  }

  private create(slot: PreviewSlot, win: BrowserWindow): SlotView {
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:aquila-preview',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    view.setBackgroundColor('#ffffff');
    win.contentView.addChildView(view);
    const s: SlotView = { view, url: '', width: 0, zoom: 1, bounds: { x: 0, y: 0, width: 0, height: 0 } };
    const wc = view.webContents;
    const nav = (loading = wc.isLoading()) =>
      this.sendNav({
        slot,
        url: wc.getURL() || s.url,
        title: wc.getTitle(),
        loading,
        error: s.error,
        errorUrl: s.errorUrl,
        canGoBack: wc.navigationHistory.canGoBack(),
      });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) this.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-start-loading', () => {
      s.error = undefined;
      s.errorUrl = undefined;
      nav(true);
    });
    wc.on('did-stop-loading', () => nav(false));
    wc.on('did-navigate', () => {
      // Zoom is per origin in Chromium: a new origin starts at 1×.
      wc.setZoomFactor(s.zoom);
      nav();
    });
    wc.on('did-navigate-in-page', () => nav());
    wc.on('page-title-updated', () => nav());
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 = aborted (a new navigation replaced this one).
      if (!isMainFrame || code === -3) return;
      s.error = `${description} (${url})`;
      s.errorUrl = url;
      nav(false);
    });
    return s;
  }

  private destroy(slot: PreviewSlot, s: SlotView, win: BrowserWindow): void {
    win.contentView.removeChildView(s.view);
    s.view.webContents.close();
    this.slots.delete(slot);
  }
}
