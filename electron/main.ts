// Main process: window, config, pty sessions, Claude hook receiver.
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  shell,
} from 'electron';
import { restoreShellPath } from './env';
import { isWindows, platform } from './platform';
import { accountsStatus, installShellFunction, prepareAccount, shellFunctionPreview } from './accounts';
import {
  CONFIG_PATH,
  editProjects,
  expand,
  loadConfig,
  openProjectIn,
  projectForPath,
  setLanguage,
  setNotifyDone,
  setProjectAccount,
} from './config';
import fs from 'node:fs';
import { showContextMenu } from './menu';
import { installAppMenu } from './appMenu';
import { GlobalShortcut, readGlobalShortcut, writeGlobalShortcut } from './globalShortcut';
import { gitAction, gitChanges, localGit, localTrash, treeOf, TreeWatcher } from './git';
import {
  ensureWorktree,
  PORT_STEP,
  removeWorktree,
  worktreeCandidates,
  worktreeInfo,
  worktreeSlot,
} from './worktrees';
import { markGuideOffered, readGuideState } from './guide';
import { releaseNotesState, usedBefore, writeLastSeen } from './releaseNotes';
import { startUpdater } from './updater';
import { displayTitle, HistoryIndex, matchProject, resumeWorktree, toMarkdown } from './history';
import { binaryFor, finishFirstRun, firstRunReport, loadOverrides, setBinaryPath } from './detect';
import {
  detectClaudeVersion,
  startHookServer,
  supportsHttpHooks,
  writeClaudeHookSettings,
  type HookEvent,
} from './hooks';
import { LIVE_SOURCES, ratio, refreshDue, UsageTracker } from './usage';
import { ContextWatcher, statusLineSources, userHasStatusLine } from './context';
import { connect as figmaConnect, FIGMA_DOCS_URL, readProfiles as figmaProfiles } from './figma';
import { PowerWatcher, type PowerSource } from './power';
import { FIXTURE_NOW, fixtureFetcher, NewsService } from './news';
import { DevUrlTracker, orderTargets, PreviewViews, readLaunchJson } from './preview';
import { SessionManager } from './sessions';
import { checkRemote } from './remote/check';
import { ensureControlDir, sshExec } from './remote/exec';
import { remoteGit, remoteGitChanges, remoteTrash } from './remote/git';
import { matchRemoteProject } from './remote/history';
import { sshHosts } from './remote/hosts';
import { CODEX_SESSIONS_DIR } from './codex';
import { clipboardPaths, findClaudeTranscript, findRollout, lastReply, readTail } from './terminalHelpers';
import {
  claudeConfigDir,
  mapLayout,
  planRestore,
  pruneScrollback,
  readScrollback,
  readState,
  removeScrollback,
  visibleKeys,
  writeScrollback,
  writeState,
  type SavedTab,
} from './state';
import { isSmoke, runSmoke, SMOKE_BUFFER_BYTES, watchOutput } from './smoke';
import { openInBrowser } from './browser';
import { accountLabel, translator } from '../src/shared/i18n/dictionary';
import {
  IPC,
  type AccountUsage,
  type ConnectionUpdate,
  type ContextMenuItem,
  type GitAction,
  type GitScope,
  type GitTarget,
  type HistoryRef,
  type Language,
  type PreviewCommand,
  type PreviewSlot,
  type PreviewState,
  type PreviewTargets,
  type ProjectEdit,
  type RemoteHost,
  type RestoreResult,
  type SavedLayout,
  type SessionInfo,
  type SessionKind,
  type ToolId,
} from '../src/shared/api/types';

const isDev = process.env.AQUILA_DEV === '1';
let win: BrowserWindow | null = null;
let sessions: SessionManager | null = null;
let previews: PreviewViews | null = null;

/** = --color-bg-canvas per theme (--p-slate-950 / --p-paper-0); the renderer follows the same nativeTheme. */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0e1014' : '#ffffff');

/** = --size-titlebar: Windows' caption buttons sit in the same band as the tab bar. */
const TITLEBAR_HEIGHT = 40;

/**
 * Windows caption buttons (T19): over the top-right corner in the title-bar band, on --color-bg-surface
 * (--p-slate-900 / --p-paper-50) with --color-text-secondary symbols (--p-slate-400 / --p-slate-500).
 */
const titleBarOverlay = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#14171d', symbolColor: '#8a91a0', height: TITLEBAR_HEIGHT }
    : { color: '#f5f6f8', symbolColor: '#5b6170', height: TITLEBAR_HEIGHT };

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: windowBackground(), // avoids a flash of the wrong color before CSS loads
    ...(isWindows
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay() }
      : { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 14 } }),
    webPreferences: {
      // compiled layout: dist-electron/electron/main.js → dist-electron/electron/preload.js
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  if (isDev) win.loadURL('http://localhost:5199');
  else win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  // A reload (dev, crash recovery) loses the renderer's pending acks: don't leave ptys paused.
  win.webContents.on('did-start-loading', () => {
    sessions?.resetFlow();
    // The new page has no preview panel yet: don't leave native views over it.
    previews?.destroyAll();
  });
  win.on('closed', () => (win = null));
  // Back to the window: the banners of what's on screen have been read (T45).
  win.on('focus', () => sessions?.seen());
}

// Windows toast notifications need the app's identity (= electron-builder appId; the installer's Start Menu shortcut carries it).
if (isWindows) app.setAppUserModelId('dev.aquila.agents');

app.whenReady().then(async () => {
  // Release notes (T27): an install from before T27 has state but no record. Read before this launch writes any.
  const seenBefore = usedBefore();
  // Force a theme for smoke / capture / checking (AQUILA_THEME=light|dark); otherwise follow macOS.
  const forced = process.env.AQUILA_THEME;
  if (forced === 'light' || forced === 'dark') nativeTheme.themeSource = forced;
  nativeTheme.on('updated', () => {
    win?.setBackgroundColor(windowBackground());
    if (isWindows) win?.setTitleBarOverlay(titleBarOverlay());
  });
  // Windows: shell profiles and WSL distros, detected once (never polled).
  if (isWindows) void platform.refreshShells();
  let pathRestored = await restoreShellPath(); // Finder launches get a minimal PATH
  loadOverrides(); // binaries picked in the first-run checklist
  // Read before any session exists: the first create/exit rewrites state.json. Smoke never touches it.
  const saved = isSmoke ? { tabs: [], layout: null, legacy: false } : readState();
  /** Current layout with tab keys; null until the renderer has restored (so the saved one isn't overwritten). */
  let layoutByKey: SavedLayout | null = saved.layout;
  const saveTabs = (tabs: SavedTab[]) => {
    try {
      writeState(tabs, layoutByKey);
    } catch (err) {
      console.error('[state] save failed', err);
    }
  };
  const safe = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error(`[state] ${what} failed`, err);
    }
  };
  let onUsageHook: ((tabId: string, hook: HookEvent) => void) | null = null;
  const hookPort = await startHookServer((tabId, hook) => {
    sessions?.onHook(tabId, hook);
    onUsageHook?.(tabId, hook);
  });
  const hookFiles = writeClaudeHookSettings(hookPort);
  // Context gauge (T31): our statusline drops Claude's statusline JSON per tab into ~/.aquila/context/.
  const context = new ContextWatcher((u) => win?.webContents.send(IPC.contextChanged, u));
  if (!isSmoke) safe('context watch', () => context.start());
  ipcMain.handle(IPC.contextGet, () => context.all());
  // Figma MCP (T32): the hidden whoami check runs with the account's config dir (its `/mcp` login).
  ipcMain.handle(IPC.figmaProfiles, () => figmaProfiles());
  ipcMain.handle(IPC.figmaConnect, (_e, account: string) => {
    const config = loadConfig();
    const a = config.accounts[account];
    if (!a) throw new Error(`Unknown account ${account}`);
    // Unset for the shared account, like its sessions (setting it would change where Claude keeps the login).
    return figmaConnect(account, a.claudeConfigDir ? claudeConfigDir(config, account) : undefined);
  });
  ipcMain.handle(IPC.figmaOpenDocs, () => shell.openExternal(FIGMA_DOCS_URL));
  // In-app preview (T33): dev server addresses from launch.json + the project's terminals; one native view per slot.
  // Per worktree (T50): its own launch.json, the addresses its tabs printed, and its PORT (as sessions.ts sets it).
  const slots = new Map<string, number>();
  const targetsOf = (projectId: string, worktree?: string): PreviewTargets => {
    const p = loadConfig().projects.find((x) => x.id === projectId);
    if (!p || p.remote) return { projectId, ...(worktree ? { worktree } : {}), urls: [] };
    const dir = worktree ?? expand(p.path);
    let port: number | undefined;
    if (p.portBase) {
      let slot = 0;
      if (worktree) {
        slot = slots.get(worktree) ?? worktreeSlot(worktree);
        slots.set(worktree, slot);
      }
      port = p.portBase + PORT_STEP * slot;
    }
    const order = orderTargets(readLaunchJson(dir), devUrls.urls(projectId, worktree), port, PORT_STEP);
    return { projectId, ...(worktree ? { worktree } : {}), ...order };
  };
  const devUrls = new DevUrlTracker(
    (projectId, worktree) => win?.webContents.send(IPC.previewTargetsChanged, targetsOf(projectId, worktree)),
    [hookPort],
  );
  previews = new PreviewViews(
    () => win,
    (nav) => win?.webContents.send(IPC.previewNav, nav),
    openInBrowser,
  );
  ipcMain.handle(IPC.previewTargets, (_e, projectId: string, worktree?: string) =>
    targetsOf(projectId, typeof worktree === 'string' && worktree ? worktree : undefined),
  );
  ipcMain.on(IPC.previewSet, (_e, { slot, state }: { slot: PreviewSlot; state: PreviewState | null }) =>
    previews?.set(slot, state),
  );
  ipcMain.on(IPC.previewCommand, (_e, { slot, command }: { slot: PreviewSlot; command: PreviewCommand }) =>
    previews?.command(slot, command),
  );
  ipcMain.handle(IPC.previewPick, (_e, slot: PreviewSlot) => previews?.pick(slot) ?? null);
  ipcMain.on(IPC.previewPickCancel, (_e, slot: PreviewSlot) => previews?.cancelPick(slot));
  // http hooks unless `claude --version` says it's older than they need (then command + curl).
  let httpHooks = true;
  const detectHooks = () =>
    detectClaudeVersion(process.env, binaryFor('claude')).then((v) => (httpHooks = supportsHttpHooks(v)));
  void detectHooks();
  const smokeOutput = { buffer: '', statuses: [] as string[], connections: [] as ConnectionUpdate[] };
  const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);
  sessions = new SessionManager({
    send: isSmoke
      ? watchOutput(
          send,
          (d) => (smokeOutput.buffer = (smokeOutput.buffer + d).slice(-SMOKE_BUFFER_BYTES)),
          (st) => smokeOutput.statuses.push(st),
          (c) => smokeOutput.connections.push(c),
        )
      : send,
    getWindow: () => win,
    hookPort,
    hookSettingsPath: ({ cwd, configDir }) => {
      // The user's own statusLine wins: ours (flag settings) would replace it.
      const status = !isSmoke && !userHasStatusLine(statusLineSources(cwd, configDir));
      if (httpHooks) return status ? hookFiles.httpStatus : hookFiles.http;
      return status ? hookFiles.legacyStatus : hookFiles.legacy;
    },
    onEnded: (id) => {
      context.remove(id);
      devUrls.forgetSession(id);
    },
    onOutput: (projectId, id, data, worktree) => devUrls.feed(projectId, worktree, id, data),
    onTabsChanged: isSmoke ? undefined : saveTabs,
    scrollback: isSmoke
      ? undefined
      : {
          read: readScrollback,
          write: (key, text) => safe('scrollback save', () => writeScrollback(key, text)),
          remove: (key) => safe('scrollback remove', () => removeScrollback(key)),
        },
  });
  const s = sessions;
  // Power profile (T9). AQUILA_POWER_SAVER=1 forces saver mode (smoke, measuring).
  const power = new PowerWatcher(powerMonitor as unknown as PowerSource); // Electron's typed overloads ⊂ PowerSource
  const powerState = () =>
    process.env.AQUILA_POWER_SAVER === '1' ? { ...power.current(), saver: true } : power.current();
  s.setSaver(powerState().saver);
  power.onChange(() => {
    s.setSaver(powerState().saver);
    send(IPC.powerChanged, powerState());
  });
  ipcMain.handle(IPC.powerGet, () => powerState());

  // Usage gauge (T30): estimated per account from its transcripts; a rate limit hit teaches the 100% mark.
  const notifyNearLimit = (u: AccountUsage, which: 'fiveHour' | 'weekly') => {
    if (!Notification.isSupported()) return;
    const config = loadConfig();
    const t = translator(config.language);
    const w = u[which];
    const percent = String(Math.round(ratio(w) * 100));
    const live = typeof w.percent === 'number';
    const time = w.resetsAt
      ? new Date(w.resetsAt).toLocaleString(config.language === 'ko' ? 'ko-KR' : 'en-US', {
          ...(which === 'weekly' ? { month: 'numeric', day: 'numeric' } : {}),
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    const body = live
      ? which === 'fiveHour'
        ? 'usage.nearBody5hLive'
        : 'usage.nearBodyWeekLive'
      : which === 'fiveHour'
        ? 'usage.nearBody5h'
        : 'usage.nearBodyWeek';
    const n = new Notification({
      title: t('usage.nearTitle', { account: accountLabel(t, u.account, config.accounts[u.account]) }),
      body: t(body, { percent, time }),
    });
    n.on('click', () => win?.show());
    n.show();
  };
  const usage = new UsageTracker({
    config: loadConfig,
    onNear: notifyNearLimit,
    // Real share from the CLIs (T30b); not in smoke / capture runs (no hidden `claude` starts there).
    live: isSmoke || process.env.AQUILA_CAPTURE ? undefined : LIVE_SOURCES,
    onUpdate: (list) => send(IPC.usageChanged, list),
  });
  const pushUsage = (p: Promise<AccountUsage[]>) =>
    p.then((list) => send(IPC.usageChanged, list)).catch((err: unknown) => console.error('[usage]', err));
  ipcMain.handle(IPC.usageGet, () => usage.refresh());
  let usageSoon: NodeJS.Timeout | undefined;
  onUsageHook = (tabId, hook) => {
    // Claude quit in this tab (the shell stays): its gauge is stale. /clear keeps it (the statusline reports anew).
    if (hook.event === 'SessionEnd' && hook.reason !== 'clear') context.remove(tabId);
    if (hook.event === 'StopFailure' && hook.error === 'rate_limit') {
      const account = s.claudeAccount(tabId);
      if (account) void pushUsage(usage.rateLimited(account));
    } else if (hook.event === 'Stop') {
      // The turn's last response is in the transcript now (or within a moment).
      clearTimeout(usageSoon);
      usageSoon = setTimeout(() => void pushUsage(usage.refresh()), 3_000);
    }
  };
  if (!isSmoke)
    setInterval(() => {
      if (win && refreshDue(Date.now() - usage.lastRefresh, win.isFocused(), powerState().saver))
        void pushUsage(usage.refresh());
    }, 60_000);

  // AI trends (T35): cached at ~/.aquila/news-cache.json. Fetched only when the modal opens (cache > 30 min) or on ↻:
  // no startup fetch, no polling.
  // Smoke and capture: fixture feeds, a throwaway cache, fixed versions and the fixtures' date (never the user's
  // cache or the network; the guide media stay the same whenever they're captured).
  const smokeNewsFile = path.join(app.getPath('temp'), `aquila-smoke-news-${process.pid}.json`);
  const news = new NewsService({
    fetcher: isSmoke
      ? fixtureFetcher(path.join(__dirname, '..', '..', 'electron', 'fixtures', 'news'))
      : async (url, headers) => {
          const r = await net.fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
          return { status: r.status, header: (n) => r.headers.get(n), text: () => r.text() };
        },
    onChange: (state) => send(IPC.newsChanged, state),
    ...(isSmoke
      ? {
          file: smokeNewsFile,
          versions: async (tool) => (tool === 'claude' ? '2.1.327' : '0.170.0'),
          now: () => FIXTURE_NOW,
        }
      : {}),
  });
  if (isSmoke) app.on('will-quit', () => fs.rmSync(smokeNewsFile, { force: true }));
  ipcMain.handle(IPC.newsGet, () => news.state());
  ipcMain.handle(IPC.newsRefresh, () => news.refresh());
  ipcMain.on(IPC.newsOpened, () => void news.opened());
  ipcMain.on(IPC.newsOpen, (_e, url: string) => {
    if (typeof url === 'string' && news.isKnownUrl(url)) void shell.openExternal(url);
  });
  ipcMain.handle(IPC.newsSummarize, (_e, { language, account }: { language: Language; account?: string }) => {
    const config = loadConfig();
    const a = account ? config.accounts[account] : undefined;
    return news.summarize(
      language,
      a?.claudeConfigDir && account ? claudeConfigDir(config, account) : undefined,
    );
  });

  // Tabs on screen in the saved layout are spawned now; the rest stay dormant until first shown (T21).
  let restored: { sessions: SessionInfo[]; keys: Map<string, string> } | null = null;
  const restoreSessions = (): RestoreResult => {
    if (!restored) {
      const config = loadConfig();
      const plans = planRestore(saved, config);
      const visible = visibleKeys(plans, saved.layout, config);
      const keys = new Map<string, string>(); // tab key → session id
      const sessions = plans.flatMap((plan) => {
        try {
          const info = visible.has(plan.key)
            ? s.create(config, plan.projectId, plan.kind, plan.account, plan, plan.worktree)
            : s.prepare(config, plan);
          keys.set(plan.key, info.id);
          return [info];
        } catch (err) {
          console.error('[state] restore failed', plan, err);
          return [];
        }
      });
      restored = { sessions, keys };
      if (!isSmoke) safe('scrollback prune', () => pruneScrollback(new Set(keys.keys())));
    }
    const { keys } = restored;
    const live = restored.sessions.filter((info) => s.has(info.id));
    const layout = saved.layout && mapLayout(saved.layout, (key) => keys.get(key) ?? null);
    return { sessions: live, layout };
  };

  ipcMain.handle(IPC.configGet, () => loadConfig());
  ipcMain.handle(IPC.configOpen, () => shell.openPath(CONFIG_PATH));
  // App menu bar (T47): relabelled when the language or the project list changes.
  const appMenu = installAppMenu({ dev: isDev, send: (c) => win?.webContents.send(IPC.menuCommand, c) });
  appMenu.refresh(loadConfig());
  ipcMain.handle(IPC.configSetLanguage, (_e, language: Language) => appMenu.refresh(setLanguage(language)));
  ipcMain.handle(IPC.configSetNotifyDone, (_e, on: unknown) => setNotifyDone(on === true));
  ipcMain.handle(
    IPC.configSetProjectAccount,
    (_e, { projectId, account }: { projectId: string; account: string }) =>
      setProjectAccount(projectId, account),
  );
  ipcMain.handle(IPC.configEditProjects, (_e, edit: ProjectEdit) => appMenu.refresh(editProjects(edit)));
  ipcMain.handle(IPC.dialogPickFolder, async () => {
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.configProjectForPath, (_e, dir: string) => projectForPath(loadConfig(), dir));
  ipcMain.handle(IPC.projectOpenIn, (_e, projectId: string) => openProjectIn(loadConfig(), projectId));
  ipcMain.handle(IPC.uiContextMenu, (e, items: ContextMenuItem[]) =>
    showContextMenu(BrowserWindow.fromWebContents(e.sender), items),
  );
  // Terminal helpers (T28): ⌘V with files/an image on the clipboard, "copy last response".
  ipcMain.on(IPC.clipboardWrite, (_e, text: unknown) => {
    if (typeof text === 'string') void clipboard.writeText(text);
  });
  ipcMain.handle(IPC.clipboardText, () => clipboard.readText());
  ipcMain.handle(IPC.clipboardPaths, async () => {
    const byType = new Map<string, Electron.ClipboardItem>();
    for (const item of await clipboard.read())
      for (const type of item.types) if (!byType.has(type)) byType.set(type, item);
    return clipboardPaths({
      types: [...byType.keys()],
      get: async (type) => {
        const blob = await byType.get(type)!.getType(type);
        return blob instanceof Blob ? Buffer.from(await blob.arrayBuffer()) : Buffer.alloc(0);
      },
    });
  });
  ipcMain.handle(IPC.sessionLastReply, (_e, id: string) => {
    const src = s.replySource(id);
    if (!src) return null;
    const file =
      src.agent === 'claude'
        ? findClaudeTranscript(claudeConfigDir(loadConfig(), src.account), src.sessionId)
        : findRollout(CODEX_SESSIONS_DIR, src.sessionId);
    return file ? lastReply(readTail(file), src.agent) : null;
  });
  ipcMain.handle(
    IPC.sessionCreate,
    (_e, { projectId, kind, account }: { projectId: string; kind: SessionKind; account?: string }) =>
      s.create(loadConfig(), projectId, kind, account),
  );
  // Remote projects (T29): local-only features refuse them with one message instead of failing on a missing folder.
  const localOnly = (projectId: string) => {
    const config = loadConfig();
    if (config.projects.find((p) => p.id === projectId)?.remote)
      throw new Error(translator(config.language)('remote.unsupported'));
  };
  ensureControlDir();
  ipcMain.handle(IPC.remoteHosts, () => sshHosts());
  ipcMain.handle(IPC.remoteCheck, (_e, host: RemoteHost) =>
    checkRemote({
      alias: String(host?.alias ?? '').trim(),
      ...(host?.claudeConfigDir ? { claudeConfigDir: String(host.claudeConfigDir) } : {}),
    }),
  );
  ipcMain.on(IPC.remoteReconnect, (_e, id: string) => s.reconnect(id));
  ipcMain.handle(
    IPC.sessionCreateWorktree,
    async (_e, { projectId, branch, kind }: { projectId: string; branch: string; kind: SessionKind }) => {
      localOnly(projectId);
      const config = loadConfig();
      const { worktree, created } = await ensureWorktree(config, projectId, branch);
      const setup = created ? config.projects.find((p) => p.id === projectId)?.setupScript : undefined;
      return s.create(config, projectId, kind, undefined, {}, worktree, setup);
    },
  );
  ipcMain.handle(IPC.worktreeInfo, (_e, projectId: string) => {
    localOnly(projectId);
    return worktreeInfo(loadConfig(), projectId);
  });
  const openWorktreePaths = () => s.tabs().flatMap((t) => (t.worktree ? [t.worktree.path] : []));
  ipcMain.handle(IPC.worktreeCandidates, (_e, projectId: string) => {
    localOnly(projectId);
    return worktreeCandidates(loadConfig(), projectId, openWorktreePaths());
  });
  ipcMain.handle(IPC.worktreeRemove, (_e, { projectId, path: target }: { projectId: string; path: string }) => {
    localOnly(projectId);
    return removeWorktree(loadConfig(), projectId, String(target ?? ''), openWorktreePaths());
  });
  ipcMain.handle(IPC.sessionRestore, () => restoreSessions());
  ipcMain.handle(IPC.sessionStart, (_e, id: string) => s.wake(loadConfig(), id));
  ipcMain.on(IPC.layoutSave, (_e, layout: SavedLayout) => {
    if (isSmoke) return;
    layoutByKey = mapLayout(layout, (id) => s.keyOf(id) ?? null);
    s.saveTabs();
  });
  ipcMain.on(IPC.sessionScrollback, (_e, { id, text }: { id: string; text: string }) =>
    s.saveScrollback(id, text),
  );
  ipcMain.handle(IPC.accountsStatus, () => accountsStatus(loadConfig()));
  ipcMain.handle(IPC.accountsPrepare, (_e, account: string) => prepareAccount(loadConfig(), account));
  ipcMain.handle(IPC.accountsShellPreview, (_e, account: string) =>
    shellFunctionPreview(loadConfig(), account),
  );
  ipcMain.handle(IPC.accountsShellInstall, (_e, account: string) =>
    installShellFunction(loadConfig(), account),
  );
  // Changes panel (T25). The renderer names a project/session; paths and commits are resolved here, never taken from it.
  const worktreeFor = (projectId: string, sessionId?: string) =>
    sessionId ? s.worktreeOf(sessionId, projectId) : undefined;
  // Remote projects (T36) read the same data over the shared SSH connection; the panel polls them (no watch).
  ipcMain.handle(IPC.gitChanges, (_e, { projectId, sessionId, scope }: GitTarget & { scope?: GitScope }) => {
    const config = loadConfig();
    const project = config.projects.find((p) => p.id === projectId);
    const base =
      scope === 'session' && sessionId ? s.startHeadOf(sessionId, projectId) || undefined : undefined;
    if (project?.remote) return remoteGitChanges(sshExec, project.remote, project.path, base);
    return gitChanges(config, projectId, worktreeFor(projectId, sessionId), base);
  });
  const treeWatcher = new TreeWatcher(() => win?.webContents.send(IPC.gitChanged));
  ipcMain.on(IPC.gitWatch, (_e, target: GitTarget | null) => {
    // A remote project has nothing to watch here (localOnly throws → no watch); its panel polls.
    try {
      if (target) localOnly(target.projectId);
      treeWatcher.watch(
        target
          ? treeOf(loadConfig(), target.projectId, worktreeFor(target.projectId, target.sessionId))
          : null,
      );
    } catch {
      treeWatcher.watch(null);
    }
  });
  app.on('before-quit', () => treeWatcher.close());
  ipcMain.handle(IPC.gitAction, (_e, a: GitAction) => {
    const config = loadConfig();
    const remote = config.projects.find((p) => p.id === a.projectId)?.remote;
    if (remote) {
      const dir = config.projects.find((p) => p.id === a.projectId)?.path ?? '';
      return gitAction(remoteGit(sshExec, remote, dir), a, remoteTrash(sshExec, remote, dir));
    }
    const cwd = treeOf(config, a.projectId, worktreeFor(a.projectId, a.sessionId));
    return gitAction(
      localGit(cwd),
      a,
      localTrash(cwd, (p) => shell.trashItem(p)),
    );
  });
  // Session history (T11): read-only over ~/.claude*/projects and ~/.codex; names and favorites in ~/.aquila.
  // Remote projects' hosts (T36) are scanned over SSH on request, after the local list is up.
  const history = new HistoryIndex(undefined, sshExec);
  const known = (ref: HistoryRef) => {
    const entry =
      ref && typeof ref.id === 'string'
        ? history.get({
            agent: ref.agent,
            id: ref.id,
            ...(typeof ref.host === 'string' && ref.host ? { host: ref.host } : {}),
          })
        : undefined;
    if (!entry) throw new Error(translator(loadConfig().language)('history.error.notFound'));
    return entry;
  };
  ipcMain.handle(IPC.historyList, () => history.list(loadConfig()));
  ipcMain.handle(IPC.historyRefreshRemote, () => history.refreshRemote(loadConfig()));
  ipcMain.handle(IPC.historySearch, (_e, query: string) => history.search(String(query ?? '')));
  ipcMain.handle(IPC.historyTranscript, (_e, ref: HistoryRef) => history.transcript(known(ref)));
  ipcMain.handle(
    IPC.historySetMeta,
    (_e, { ref, change }: { ref: HistoryRef; change: { name?: string | null; favorite?: boolean } }) =>
      history.setMeta(known(ref), {
        ...(change.name !== undefined
          ? { name: typeof change.name === 'string' ? change.name.slice(0, 200) : null }
          : {}),
        ...(typeof change.favorite === 'boolean' ? { favorite: change.favorite } : {}),
      }) ?? null,
  );
  ipcMain.handle(IPC.historyExport, async (_e, ref: HistoryRef) => {
    const entry = known(ref);
    const title = displayTitle(entry);
    const file = `${
      title
        .replace(/[/\\:*?"<>|\n]+/g, ' ')
        .trim()
        .slice(0, 60) || entry.id
    }.md`;
    const options: Electron.SaveDialogOptions = {
      defaultPath: path.join(app.getPath('downloads'), file),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    };
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, toMarkdown({ ...entry, title }, await history.fullTranscript(entry)));
    return r.filePath;
  });
  ipcMain.handle(
    IPC.historyResume,
    async (_e, { ref, addProject }: { ref: HistoryRef; addProject: boolean }) => {
      const entry = known(ref);
      const t = translator(loadConfig().language);
      // On an SSH host (T36): resume in a remote project on that host whose folder holds the session's folder.
      const remote = history.remoteOf(entry);
      if (remote) {
        let config = loadConfig();
        let added = false;
        let projectId = matchRemoteProject(config, remote.host.alias, remote.home, entry.cwd);
        if (!projectId && addProject) {
          config = editProjects({
            op: 'addProject',
            path: entry.cwd,
            name: '',
            group: config.groups[0]?.id ?? 'work',
            account: Object.keys(config.accounts)[0] ?? 'shared',
            remote: remote.host,
          });
          added = true;
          projectId = matchRemoteProject(config, remote.host.alias, remote.home, entry.cwd);
        }
        if (!projectId) throw new Error(t('history.error.noProject'));
        const session =
          entry.agent === 'claude'
            ? s.create(config, projectId, 'claude', undefined, { resumeClaude: entry.id })
            : s.create(config, projectId, 'codex', undefined, { resumeCodexId: entry.id });
        return added ? { session, config } : { session };
      }
      if (!fs.existsSync(entry.cwd)) throw new Error(t('history.error.folderGone', { path: entry.cwd }));
      let config = loadConfig();
      let added = false;
      let projectId = matchProject(config, entry.cwd);
      if (!projectId && addProject) {
        const account =
          entry.account && config.accounts[entry.account] ? entry.account : Object.keys(config.accounts)[0];
        config = editProjects({
          op: 'addProject',
          path: entry.cwd,
          name: '',
          group: config.groups[0]?.id ?? 'work',
          account: account ?? 'shared',
        });
        added = true;
        projectId = matchProject(config, entry.cwd);
      }
      const project = projectId && config.projects.find((p) => p.id === projectId);
      if (!project) throw new Error(t('history.error.noProject'));
      const worktree = resumeWorktree(project.path, entry.cwd, entry.branch);
      const session =
        entry.agent === 'claude'
          ? s.create(config, project.id, 'claude', entry.account, { resumeClaude: entry.id }, worktree)
          : s.create(config, project.id, 'codex', undefined, { resumeCodexId: entry.id }, worktree);
      return added ? { session, config } : { session };
    },
  );
  // First-run checklist (T17). Smoke never reads or writes its state: it always reports "not pending".
  ipcMain.handle(IPC.firstRunGet, async (_e, recheck: boolean) => {
    if (recheck) pathRestored = (await restoreShellPath()) || pathRestored;
    const report = await firstRunReport(pathRestored);
    return isSmoke ? { ...report, pending: false } : report;
  });
  ipcMain.handle(IPC.firstRunFinish, () => {
    if (!isSmoke) finishFirstRun();
  });
  ipcMain.handle(IPC.firstRunPickBinary, async (_e, tool: ToolId) => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'showHiddenFiles'],
      defaultPath: process.env.HOME,
    };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = r.canceled ? undefined : r.filePaths[0];
    if (!file) return null;
    const check = await setBinaryPath(tool, file);
    if (tool === 'claude') void detectHooks();
    return check;
  });
  ipcMain.handle(IPC.firstRunResetBinary, async (_e, tool: ToolId) => {
    const check = await setBinaryPath(tool, null);
    if (tool === 'claude') void detectHooks();
    return check;
  });
  // In-app guide (T23). Smoke never reads or writes its state: the tour is never offered.
  ipcMain.handle(IPC.guideGet, () => (isSmoke ? { offered: true } : readGuideState()));
  ipcMain.handle(IPC.guideOffered, () => {
    if (!isSmoke) markGuideOffered();
  });
  // Release notes (T27). Smoke: everything counts as seen, nothing auto-opens; ⌘K → What's new still works.
  ipcMain.handle(IPC.releaseNotesGet, () =>
    isSmoke
      ? { current: app.getVersion(), lastSeen: app.getVersion(), fresh: false }
      : releaseNotesState(app.getVersion(), seenBefore),
  );
  ipcMain.handle(IPC.releaseNotesSeen, (_e, version: string) => {
    if (!isSmoke && typeof version === 'string') writeLastSeen(version);
  });
  ipcMain.on(IPC.sessionWrite, (_e, { id, data }: { id: string; data: string }) => s.write(id, data));
  ipcMain.on(IPC.sessionResize, (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) =>
    s.resize(id, cols, rows),
  );
  ipcMain.on(IPC.sessionKill, (_e, { id }: { id: string }) => s.kill(id));
  ipcMain.on(IPC.sessionSeen, (_e, { id }: { id: string }) => s.markSeen(id));
  ipcMain.on(IPC.sessionRename, (_e, { id, title }: { id: string; title: unknown }) =>
    s.rename(id, typeof title === 'string' ? title : ''),
  );
  ipcMain.on(IPC.uiActive, (_e, { id }: { id: string | null }) => s.setActive(id));
  ipcMain.on(IPC.sessionAck, (_e, { id }: { id: string }) => s.ack(id));
  ipcMain.on(IPC.sessionVisible, (_e, { id, visible }: { id: string; visible: boolean }) =>
    s.setVisible(id, visible),
  );

  // Global shortcut (T41): off until the user picks a key. Pressing it brings the window up; the renderer then
  // focuses the next waiting session. Smoke never reads, writes or registers it.
  const summon = () => {
    if (!win) return createWindow();
    const wasFocused = win.isFocused() && win.isVisible() && !win.isMinimized();
    if (win.isMinimized()) win.restore();
    win.show();
    if (process.platform === 'darwin') app.focus({ steal: true });
    win.focus();
    win.webContents.send(IPC.globalShortcutFired, { wasFocused });
  };
  const shortcut = new GlobalShortcut(globalShortcut, summon, {
    read: () => (isSmoke ? null : readGlobalShortcut()),
    write: (a) => {
      if (!isSmoke) writeGlobalShortcut(a);
    },
  });
  shortcut.start();
  ipcMain.handle(IPC.globalShortcutGet, () => shortcut.current());
  ipcMain.handle(IPC.globalShortcutSet, (_e, accelerator: unknown) =>
    accelerator === null || typeof accelerator === 'string' ? shortcut.set(accelerator) : shortcut.state('invalid'),
  );
  app.on('will-quit', () => shortcut.dispose());

  createWindow();
  // T27: notify when a newer release is out (packaged builds only).
  if (app.isPackaged && !isSmoke && !process.env.AQUILA_CAPTURE)
    safe('updater', () => startUpdater(() => translator(loadConfig().language)));
  if (isSmoke && win) {
    const w = win;
    w.webContents.once('did-finish-load', () => runSmoke(w, s, loadConfig(), smokeOutput, previews));
  }
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
// Hold the quit until the ptys have exited (bounded): exiting earlier can abort in node-pty (see exitWait.ts).
let ptysDone = false;
app.on('before-quit', (e) => {
  if (ptysDone || !sessions) return;
  e.preventDefault();
  void sessions.killAll().finally(() => {
    ptysDone = true;
    app.quit();
  });
});
