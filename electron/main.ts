// Main process: window, config, pty sessions, Claude hook receiver.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  protocol,
  shell,
  utilityProcess,
  WebContentsView,
  Menu,
  screen,
  session as electronSession,
} from 'electron';
import { restoreShellPath } from './env';
import { isWindows, platform } from './platform';
import { externalTarget, isAppPage } from './links';
import { accountsStatus, installShellFunction, prepareAccount, shellFunctionPreview } from './accounts';
import {
  APP_DIR,
  CONFIG_PATH,
  editProjects,
  expand,
  loadConfig,
  openProjectIn,
  projectForPath,
  setLanguage,
  setNotifyDone,
  setProjectAccount,
  setTheme,
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
import {
  displayTitle,
  HistoryIndex,
  matchProject,
  readClaudeCommands,
  resumeWorktree,
  toMarkdown,
} from './history';
import { binaryFor, finishFirstRun, firstRunReport, loadOverrides, setBinaryPath } from './detect';
import {
  detectClaudeVersion,
  startHookServer,
  supportsHttpHooks,
  pruneStaleHookSettings,
  removeClaudeHookSettings,
  writeClaudeHookSettings,
  type HookEvent,
} from './hooks';
import { LIVE_SOURCES, ratio, refreshDue, UsageTracker } from './usage';
import { ContextWatcher, statusLineSources, userHasStatusLine } from './context';
import { listRemoteDirs } from './remote/browse';
import { connect as figmaConnect, FIGMA_DOCS_URL, readProfiles as figmaProfiles } from './figma';
import { PowerWatcher, type PowerSource } from './power';
import { FIXTURE_NOW, fixtureFetcher, NewsService, readHead } from './news';
import {
  applyPrompt,
  ApplyService,
  articleText,
  branchFor,
  fixtureClaude,
  runClaudePlan,
  scanRepo,
  tmpAppliesDir,
} from './apply';
import { GraphService } from './graph';
import {
  AppNodes,
  addToSection,
  dailyHeading,
  dailyLines,
  dailyTitle,
  transcriptsWork,
} from './graph/app-nodes';
import { TurnFiles } from './graph/turn-files';
import { WorkScanner, type WorkScanOut } from './graph/history-worker';
import { linkable, withLink } from './graph/rules';
import { VaultService } from './graph/vault';
import { runClaudeHaiku } from './graph/extract';
import {
  IMAGE_FILE,
  imageUrlPath,
  isWebUrl,
  NoteWatcher,
  readNote,
  saveAttachment,
  writeNote,
} from './graph/note-file';
import { NoteSeen, NoteSeenStore } from './graph/note-seen';
import { DevUrlTracker, orderTargets, PreviewViews, readLaunchJson } from './preview';
import { EXT_SCHEME, ExtensionHost } from './extensions';
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
import { isHidden, isSmoke, runSmoke, SMOKE_BUFFER_BYTES, smokeLinks, watchOutput } from './smoke';
import { openInBrowser } from './browser';
import { defaultRunCommands, readSavedRuns, RunManager, writeSavedRuns } from './runs';
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
  type ApplyAnalyseRequest,
  type ApplyStep,
  type NewsSourceId,
  type NoteWriteResult,
  type GraphDecision,
  type GraphRuleOp,
  type VaultConfig,
  type VaultEdit,
  type NoteTableData,
  type VaultProperty,
  type VaultPresetId,
  type VaultScope,
  type ToolId,
  type StatusUpdate,
  type ExtensionViewState,
} from '../src/shared/api/types';

const isDev = process.env.AQUILA_DEV === '1';
let win: BrowserWindow | null = null;
let sessions: SessionManager | null = null;
let previews: PreviewViews | null = null;
let extensions: ExtensionHost | null = null;
/** Notes open in the editor (T67); a reloaded page has none open. */
let notesWatched: NoteWatcher | null = null;
let runs: RunManager | null = null;
/** Runs up at quit start again next launch (T60); written as they change, frozen once quitting starts. */
const RUNS_PATH = path.join(APP_DIR, 'runs.json');
let quitting = false;

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
    // Background smoke / perf (AQUILA_HIDDEN): never shown or focused; smoke.ts shows it inactive and transparent.
    ...(isHidden ? { show: false, opacity: 0.01 } : {}),
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
  if (isHidden) win.showInactive();
  // Links (terminal URLs, Claude's OSC 8 links): the default browser, never a window of ours (see links.ts).
  const wc = win.webContents;
  const openLink = (url: string) => {
    const target = externalTarget(url);
    if (!target) return;
    if (isSmoke) smokeLinks.push(target); // smoke checks where it went; no browser opens
    else void shell.openExternal(target);
  };
  wc.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isAppPage(url, wc.getURL())) return;
    e.preventDefault();
    openLink(url);
  });
  if (isDev) win.loadURL('http://localhost:5199');
  else win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  // A reload (dev, crash recovery) loses the renderer's pending acks: don't leave ptys paused.
  win.webContents.on('did-start-loading', () => {
    sessions?.resetFlow();
    // The new page has no preview panel yet: don't leave native views over it.
    previews?.destroyAll();
    extensions?.destroyAll();
    // Nor notes open in its editor: stop their folder watches (the new page opens what it shows).
    notesWatched?.close();
  });
  win.on('closed', () => {
    win = null;
    // Floating extension windows (T71) must not keep the app alive without its window.
    extensions?.destroyAll();
  });
  // Back to the window: the banners of what's on screen have been read (T45).
  win.on('focus', () => sessions?.seen());
}

// Windows toast notifications need the app's identity (= electron-builder appId; the installer's Start Menu shortcut carries it).
if (isWindows) app.setAppUserModelId('dev.aquila.agents');

// Note editor (T67): images next to notes, shown inline. Only files inside an enabled source (checked per request).
protocol.registerSchemesAsPrivileged([
  { scheme: 'aquila-note', privileges: { standard: true, secure: true } },
  // Extensions (T71): one origin per extension, `aquila-ext://<id>/` (its own storage, CSP'd, sandboxed).
  { scheme: EXT_SCHEME, privileges: { standard: true, secure: true } },
]);

app.whenReady().then(async () => {
  // Release notes (T27): an install from before T27 has state but no record. Read before this launch writes any.
  const seenBefore = usedBefore();
  // Force a theme for smoke / capture / checking (AQUILA_THEME=light|dark); otherwise follow macOS.
  const forced = process.env.AQUILA_THEME;
  if (forced === 'light' || forced === 'dark') nativeTheme.themeSource = forced;
  else nativeTheme.themeSource = loadConfig().theme ?? 'system'; // ⚙ Appearance
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
  let onGraphHook: ((hook: HookEvent) => void) | null = null;
  const hookPort = await startHookServer((tabId, hook) => {
    sessions?.onHook(tabId, hook);
    onUsageHook?.(tabId, hook);
    onGraphHook?.(hook);
  });
  // Per instance (the port is in the file): dev / smoke / capture no longer repoint the running app's tabs.
  const hookFiles = writeClaudeHookSettings(hookPort);
  // `exit` too: smoke / capture / perf end with app.exit(), which skips will-quit. Leftovers are pruned next start.
  app.on('will-quit', () => removeClaudeHookSettings(hookFiles));
  process.on('exit', () => removeClaudeHookSettings(hookFiles));
  void pruneStaleHookSettings(hookPort).catch((err: unknown) => console.error('[hooks] prune failed', err));
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
  /** Usage last reported (T30): extensions read it instead of starting a transcript scan of their own. */
  let lastUsage: AccountUsage[] | null = null;
  const send = (channel: string, payload: unknown) => {
    // Extensions (T71) see session statuses as counts and usage as percent; taken from what the window is sent.
    if (channel === IPC.sessionStatus) {
      const u = payload as StatusUpdate;
      extensions?.sessionStatus(u.id, u.status);
    } else if (channel === IPC.usageChanged) {
      lastUsage = payload as AccountUsage[];
      extensions?.usageChanged(lastUsage);
    }
    win?.webContents.send(channel, payload);
  };
  // In-app preview (T33): dev server addresses from launch.json + the project's terminals; one native view per slot.
  // Per worktree (T50): its own launch.json, the addresses its tabs printed, and its PORT (as sessions.ts sets it).
  const slots = new Map<string, number>();
  /** A worktree's `PORT` (as sessions.ts sets it): the base + 10 per position in `git worktree list`. */
  const portFor = (p: { portBase?: number }, worktree?: string): number | undefined => {
    if (!p.portBase) return undefined;
    let slot = 0;
    if (worktree) {
      slot = slots.get(worktree) ?? worktreeSlot(worktree);
      slots.set(worktree, slot);
    }
    return p.portBase + PORT_STEP * slot;
  };
  const targetsOf = (projectId: string, worktree?: string): PreviewTargets => {
    const p = loadConfig().projects.find((x) => x.id === projectId);
    if (!p || p.remote) return { projectId, ...(worktree ? { worktree } : {}), urls: [] };
    const dir = worktree ?? expand(p.path);
    const port = portFor(p, worktree);
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
  ipcMain.handle(IPC.previewCapture, (_e, slot: PreviewSlot) => previews?.capture(slot) ?? null);
  // Run slot (T60): dev servers / watchers apart from the agent, local projects only. Their addresses feed the
  // preview like a tab's would.
  const runDir = (projectId: unknown, worktree: unknown) => {
    const p = loadConfig().projects.find((x) => x.id === projectId);
    if (!p || p.remote) throw new Error('Run is for local projects only');
    const wt = typeof worktree === 'string' && worktree ? worktree : undefined;
    const dir = wt ?? expand(p.path);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory())
      throw new Error(`Folder not found: ${dir}`);
    const commands = p.runCommands?.length ? p.runCommands : defaultRunCommands(dir);
    return { p, wt, dir, commands };
  };
  const runList = (projectId: string, worktree?: string) => {
    try {
      const { wt, commands } = runDir(projectId, worktree);
      return runs!.list(projectId, wt, commands);
    } catch {
      return runs!.list(projectId, worktree, []);
    }
  };
  const saveRuns = () => {
    if (isSmoke || quitting || !runs) return;
    safe('runs save', () => writeSavedRuns(RUNS_PATH, runs!.active()));
  };
  runs = new RunManager({
    onChange: (projectId, worktree) => {
      send(IPC.runsChanged, runList(projectId, worktree));
      saveRuns();
    },
    onData: (id, data) => send(IPC.runData, { id, data }),
    onOutput: (projectId, worktree, id, data) => devUrls.feed(projectId, worktree, id, data),
    ignorePorts: [hookPort],
    windows: isWindows,
  });
  const runManager = runs;
  ipcMain.handle(IPC.runList, (_e, { projectId, worktree }: { projectId: string; worktree?: string }) =>
    runList(projectId, worktree),
  );
  ipcMain.handle(
    IPC.runStart,
    async (_e, { projectId, worktree, name }: { projectId: string; worktree?: string; name: string }) => {
      const { p, wt, dir, commands } = runDir(projectId, worktree);
      const c = commands.find((x) => x.name === name);
      if (!c) throw new Error(`No run command named ${name}`);
      await runManager.start({
        projectId,
        worktree: wt,
        name,
        command: c.command,
        ready: c.ready,
        cwd: dir,
        port: portFor(p, wt),
      });
      return runList(projectId, wt);
    },
  );
  ipcMain.handle(IPC.runStop, async (_e, id: string) => {
    await runManager.stop(id);
    saveRuns();
  });
  ipcMain.handle(IPC.runLog, (_e, id: string) => runManager.log(id));
  // Restore (T60): what was up when the app last quit, if its project, command and folder are still there.
  if (!isSmoke && !process.env.AQUILA_CAPTURE)
    for (const r of readSavedRuns(RUNS_PATH)) {
      try {
        const { p, wt, dir, commands } = runDir(r.projectId, r.worktree);
        const c = commands.find((x) => x.name === r.name);
        if (c)
          void runManager.start({
            projectId: r.projectId,
            worktree: wt,
            name: r.name,
            command: c.command,
            ready: c.ready,
            cwd: dir,
            port: portFor(p, wt),
          });
      } catch {
        /* project or folder gone: dropped on the next save */
      }
    }
  // Last resort (smoke / capture end with app.exit, which skips before-quit): no server outlives the app.
  process.on('exit', () => runManager.killAllNow());
  // http hooks unless `claude --version` says it's older than they need (then command + curl).
  let httpHooks = true;
  const detectHooks = () =>
    detectClaudeVersion(process.env, binaryFor('claude')).then((v) => (httpHooks = supportsHttpHooks(v)));
  void detectHooks();
  const smokeOutput = { buffer: '', statuses: [] as string[], connections: [] as ConnectionUpdate[] };
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
      extensions?.sessionEnded(id);
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
  // Extensions (T71): folders under ~/.aquila/extensions (smoke: a temp folder of its own). Nothing runs until the
  // panel shows one, or the user allowed one in the background.
  const extDir = isSmoke ? path.join(app.getPath('temp'), `aquila-smoke-ext-${process.pid}`) : path.join(APP_DIR, 'extensions');
  extensions = new ExtensionHost({
    dir: extDir,
    prefsPath: isSmoke ? path.join(extDir, '.prefs.json') : path.join(APP_DIR, 'extensions.json'),
    dataDir: isSmoke ? path.join(extDir, '.data') : path.join(APP_DIR, 'extensions-data'),
    getWindow: () => win,
    electron: {
      WebContentsView,
      BrowserWindow,
      Menu,
      fromPartition: (p) => electronSession.fromPartition(p),
      displays: () => screen.getAllDisplays().map((d) => d.workArea),
    },
    canvas: windowBackground,
    translate: () => translator(loadConfig().language),
    preload: path.join(__dirname, 'extension-preload.js'),
    power: powerState,
    usage: () => (lastUsage ? Promise.resolve(lastUsage) : usage.refresh()),
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    },
    onChanged: (list) => send(IPC.extensionsChanged, list),
  });
  const ext = extensions;
  power.onChange(() => ext.powerChanged(powerState()));
  app.on('will-quit', () => ext.dispose());
  ipcMain.handle(IPC.extensionsList, () => {
    ext.scan();
    ext.watch();
    return ext.list();
  });
  ipcMain.handle(IPC.extensionsSetEnabled, (_e, { id, enabled }: { id: string; enabled: boolean }) =>
    ext.setEnabled(String(id), enabled === true),
  );
  ipcMain.handle(IPC.extensionsSetBackground, (_e, { id, allowed }: { id: string; allowed: boolean }) =>
    ext.setBackground(String(id), allowed === true),
  );
  ipcMain.on(IPC.extensionsShow, (e, { id, state }: { id: string; state: ExtensionViewState | null }) => {
    // Only the app window places views.
    if (e.sender !== win?.webContents) return;
    if (state) ext.hideAll(id);
    ext.show(String(id), state);
  });
  ipcMain.handle(IPC.extensionsFloat, (_e, { id, floating }: { id: string; floating: boolean }) =>
    ext.setFloat(String(id), floating === true),
  );
  ipcMain.handle(
    IPC.extensionsFloatStyle,
    (_e, { id, style }: { id: string; style: { opacity?: unknown; onTop?: unknown } }) =>
      ext.setFloatStyle(String(id), {
        opacity: typeof style?.opacity === 'number' ? style.opacity : undefined,
        onTop: typeof style?.onTop === 'boolean' ? style.onTop : undefined,
      }),
  );
  ipcMain.on(IPC.extensionsReload, (_e, id: string) => ext.reload(String(id)));
  ipcMain.on(IPC.extensionsCommand, (_e, { id, commandId }: { id: string; commandId: string }) =>
    ext.command(String(id), String(commandId)),
  );
  ipcMain.handle(
    IPC.extensionsCreate,
    (_e, { name, group, account }: { name: string; group: string; account: string }) => {
      const created = ext.create(String(name ?? ''));
      // Added as a project (named like the extension) so "New extension" can open a Claude tab in its folder.
      let config = loadConfig();
      let projectId = projectForPath(config, created.dir);
      if (!projectId) {
        config = appMenu.refresh(
          editProjects({ op: 'addProject', path: created.dir, name: String(name ?? '').trim(), group, account }),
        );
        graph.projectsChanged(); // T73: its folder joins the graph
        projectId = projectForPath(config, created.dir);
      }
      if (!projectId) throw new Error('could not add the extension folder as a project');
      return { ...created, projectId, config };
    },
  );
  ipcMain.handle(IPC.extensionsOpenFolder, async (_e, id?: string) => {
    fs.mkdirSync(extDir, { recursive: true });
    const target = typeof id === 'string' && /^[a-z0-9-]+$/.test(id) ? path.join(extDir, id) : extDir;
    const err = await shell.openPath(fs.existsSync(target) ? target : extDir);
    if (err) throw new Error(err);
  });
  // Requests from extension views: the host checks the sender is one of its views and the manifest allows it.
  ipcMain.handle(IPC.extensionRequest, (e, method: unknown, params: unknown) =>
    ext.request(e.sender, method, params),
  );

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
          return {
            status: r.status,
            header: (n) => r.headers.get(n),
            text: (max) => (max && r.body ? readHead(r.body.getReader(), max) : r.text()),
          };
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
  ipcMain.handle(IPC.configSetTheme, (_e, mode: unknown) => {
    const m = mode === 'light' || mode === 'dark' ? mode : 'system';
    const c = setTheme(m);
    // The renderer's prefers-color-scheme follows themeSource, so the tokens switch without a reload.
    if (!process.env.AQUILA_THEME) nativeTheme.themeSource = m;
    return c;
  });
  ipcMain.handle(
    IPC.configSetProjectAccount,
    (_e, { projectId, account }: { projectId: string; account: string }) =>
      setProjectAccount(projectId, account),
  );
  ipcMain.handle(IPC.configEditProjects, (_e, edit: ProjectEdit) => {
    if (edit.op === 'removeProject') void runs?.stopProject(edit.id);
    const config = appMenu.refresh(editProjects(edit));
    // T73: project folders are graph sources: they follow the project list.
    graph.projectsChanged();
    return config;
  });
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
  ipcMain.handle(IPC.sessionAgentIds, () => s.agentIds());
  // T59: a live Claude tab's Bash commands, read whole from its transcript (output is never read).
  ipcMain.handle(IPC.sessionCommands, async (_e, id: string) => {
    const src = s.replySource(id);
    if (src?.agent !== 'claude') return null;
    const file = findClaudeTranscript(claudeConfigDir(loadConfig(), src.account), src.sessionId);
    return file ? readClaudeCommands(file) : [];
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
  ipcMain.handle(IPC.remoteList, (_e, { host, path: dir }: { host: RemoteHost; path: string }) =>
    listRemoteDirs(
      {
        alias: String(host?.alias ?? '').trim(),
        ...(host?.claudeConfigDir ? { claudeConfigDir: String(host.claudeConfigDir) } : {}),
      },
      String(dir ?? ''),
    ),
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
  ipcMain.handle(
    IPC.worktreeRemove,
    (_e, { projectId, path: target }: { projectId: string; path: string }) => {
      localOnly(projectId);
      return removeWorktree(loadConfig(), projectId, String(target ?? ''), openWorktreePaths());
    },
  );
  // Apply a trend (T64): only on the button. Scan = one pass; analysis = one hidden `claude -p` in plan mode the user
  // can cancel; Apply = worktree `trend/<slug>` + a Claude tab (the renderer pastes the approved steps).
  // Smoke / capture: a fixture reply and article, decisions in a throwaway folder.
  const fixtures = path.join(__dirname, '..', '..', 'electron', 'fixtures', 'apply');
  const applies = new ApplyService({
    runClaude: isSmoke
      ? fixtureClaude(path.join(fixtures, 'graphify-reply.json'))
      : (prompt, cwd, configDir) => runClaudePlan(binaryFor('claude'))(prompt, cwd, configDir),
    fetchText: async (url) => {
      if (!news.isKnownUrl(url)) return null;
      if (isSmoke)
        return /news\.hada\.io\/topic\?id=37690/.test(url)
          ? articleText(fs.readFileSync(path.join(fixtures, 'graphify.html'), 'utf8'))
          : null;
      const r = await net.fetch(url, {
        headers: { 'User-Agent': 'aquila-agents' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok || !r.body || !/html|text/.test(r.headers.get('content-type') ?? '')) return null;
      return articleText(await readHead(r.body.getReader(), 512 * 1024));
    },
    ...(isSmoke ? { dir: tmpAppliesDir() } : {}),
  });
  if (isSmoke) app.on('will-quit', () => fs.rmSync(tmpAppliesDir(), { recursive: true, force: true }));
  const projectRoot = (projectId: string) => {
    localOnly(projectId);
    const p = loadConfig().projects.find((x) => x.id === projectId);
    if (!p) throw new Error(`Unknown project: ${projectId}`);
    return expand(p.path);
  };
  ipcMain.handle(IPC.applyScan, (_e, projectId: string) => scanRepo(projectRoot(String(projectId))));
  ipcMain.handle(IPC.applyAnalyse, (_e, req: ApplyAnalyseRequest) => {
    const root = projectRoot(String(req?.projectId));
    // An industry item, or a CLI release (`claude@2.1.329`): new CLI features are trends too.
    const state = news.state();
    const found = state.industry.find((i) => i.id === req.itemId);
    const release = found
      ? null
      : state.cli.flatMap((c) =>
          c.releases
            .filter((r) => `${c.tool}@${r.version}` === req.itemId)
            .map((r) => ({
              id: req.itemId,
              title: `${c.tool === 'claude' ? 'Claude Code' : 'Codex'} ${r.version}`,
              url: r.url,
              source: (c.tool === 'claude' ? 'claude-code' : 'codex') as NewsSourceId,
              excerpt: r.added.map((a) => `- ${a}`).join('\n'),
            })),
        )[0];
    const item = found ?? release;
    if (!item) throw new Error('Unknown trend item');
    const config = loadConfig();
    const account = config.projects.find((p) => p.id === req.projectId)?.account;
    const a = account ? config.accounts[account] : undefined;
    return applies.analyse({
      id: String(req.id),
      projectId: req.projectId,
      root,
      article: {
        itemId: item.id,
        title: item.title,
        url: item.url,
        source: item.source,
        excerpt: item.excerpt,
      },
      language: req.language === 'ko' ? 'ko' : 'en',
      configDir: a?.claudeConfigDir && account ? claudeConfigDir(config, account) : undefined,
      request: typeof req.request === 'string' ? req.request.slice(0, 1000) : undefined,
      steps: Array.isArray(req.steps) ? req.steps.slice(0, 12) : undefined,
    });
  });
  ipcMain.on(IPC.applyCancel, (_e, id: string) => applies.cancel(String(id)));
  ipcMain.handle(IPC.applyDrop, (_e, id: string) => {
    applies.drop(String(id));
    appTouched();
  });
  ipcMain.handle(IPC.applyStart, async (_e, { id, steps }: { id: string; steps: ApplyStep[] }) => {
    const record = applies.read(String(id));
    if (!record) throw new Error('Unknown proposal');
    localOnly(record.projectId);
    const config = loadConfig();
    const branch = branchFor(record.article.title, record.id);
    // Validated before anything is created: no steps → nothing happens.
    const approved = applies.applied(record.id, Array.isArray(steps) ? steps : [], branch).approved ?? [];
    appTouched();
    const { worktree, created } = await ensureWorktree(config, record.projectId, branch);
    const setup = created ? config.projects.find((p) => p.id === record.projectId)?.setupScript : undefined;
    const session = s.create(config, record.projectId, 'claude', undefined, {}, worktree, setup);
    return { session, prompt: applyPrompt(approved, config.language) };
  });
  // Knowledge graph sources (T65): nothing runs until the renderer first asks; the index lives in a worker thread
  // that runs only while a source is enabled. Smoke: a throwaway folder.
  const graphDir = isSmoke
    ? path.join(app.getPath('temp'), `aquila-smoke-graph-${process.pid}`)
    : path.join(APP_DIR, 'graph');
  const graph = new GraphService({
    dir: graphDir,
    workerFile: path.join(__dirname, 'graph', 'worker.js').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'),
    saver: powerState().saver,
    // Capture runs as smoke too, but shows the demo projects' notes the way a user sees them.
    autoProjects: !isSmoke || !!process.env.AQUILA_CAPTURE,
    projects: () =>
      loadConfig()
        .projects.filter((p) => !p.remote)
        .map((p) => ({ id: p.id, root: expand(p.path) })),
    onStatus: (st) => send(IPC.graphStatusChanged, st),
    // T68 AI extraction: the shared Claude account; smoke reads a canned reply.
    claude: () => ({
      binary: binaryFor('claude'),
      ...(isSmoke
        ? { fixture: path.join(__dirname, '..', '..', 'electron', 'fixtures', 'links', 'ai-reply.json') }
        : {}),
    }),
    // T69: each source's link rules, and its shared settings file changing on disk.
    vaultLinks: (ids) => vault.linkRules(ids),
    onVaultFile: (id) => vault.fileChanged(id),
    // Smoke has no hooks to say a turn ended: it reads again on every snapshot.
    app: (nodes) => {
      if (isSmoke) appNodes.invalidate();
      return appNodes.graph(nodes);
    },
  });
  // The app in the graph (T70): sessions from the history index's scan (only re-parses changed transcripts), the
  // applies kept on disk. Loaded on a snapshot, again only after a Claude turn ends or an apply is decided.
  const localProjects = () =>
    loadConfig()
      .projects.filter((p) => !p.remote)
      .map((p) => ({ id: p.id, root: path.resolve(expand(p.path)) }));
  // Its own lite scan (titles, edited files, @mentions — no message text), in a short-lived child process so the
  // memory of reading every transcript goes away with it; only changed transcripts are read again.
  const workerPath = path
    .join(__dirname, 'graph', 'history-worker.js')
    .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  const workScanner = new WorkScanner(
    (input) =>
      new Promise<WorkScanOut>((resolve) => {
        const child = utilityProcess.fork(workerPath, [], { serviceName: 'Aquila history scan' });
        let done = false;
        child.once('message', (out: WorkScanOut) => {
          done = true;
          resolve(out);
        });
        child.once('exit', (code) => {
          if (!done) resolve({ error: `history scan exited (${code})` });
        });
        child.postMessage(input);
      }),
  );
  const appNodes = new AppNodes(async () => {
    const scan = await workScanner.scan(loadConfig());
    // Smoke: plus transcripts it writes into its throwaway graph folder.
    const extra = isSmoke ? transcriptsWork(path.join(graphDir, 'transcripts'), projectOfFile) : [];
    return {
      sessions: [...scan.work, ...extra],
      applies: applies.list(),
      projects: localProjects(),
      turnFiles: turns.all(),
      // T76: tabs' conversations are in the graph before they touch a note ("This tab").
      open: s.agentIds().map((a) => `${a.agent}:${a.sessionId}`),
    };
  });
  // Files a Claude turn changed by any means, shell included: the folder's git status at the prompt and at Stop.
  // Only while a note source is enabled (two git calls per turn).
  const turns = new TurnFiles({ file: path.join(graphDir, 'turns.json'), onChange: () => appTouched() });
  const projectOfFile = (abs: string) => {
    const file = path.resolve(abs);
    return localProjects()
      .filter((p) => file.startsWith(p.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0]?.id;
  };
  const appTouched = () => {
    appNodes.invalidate();
    graph.appChanged();
  };
  onGraphHook = (hook) => {
    if (hook.sessionId && hook.cwd && graph.hasEnabled()) {
      if (hook.event === 'UserPromptSubmit') turns.start(hook.sessionId, hook.cwd);
      else if (hook.event === 'Stop') void turns.stop(hook.sessionId).catch(() => undefined);
    }
    // A prompt adds nothing to draw yet (the open tab is already in the graph, T76): the turn's end does.
    if (hook.event === 'Stop' || hook.event === 'SessionEnd') appTouched();
  };
  // Daily note (T70): today's sessions (local and the last SSH scan) appended to the day's note, on the button only.
  ipcMain.handle(IPC.graphDailyNote, async (_e, sourceId: string | null) => {
    // The source picked in the graph, else one with a day template (a journal), else the first.
    const ids = graph.enabledIds();
    const id =
      (typeof sourceId === 'string' && ids.includes(sourceId) && sourceId) ||
      ids.find((x) => vault.dateTemplate(x)) ||
      ids[0];
    if (!id) return null;
    const config = loadConfig();
    const now = new Date();
    const tid = vault.dateTemplate(id);
    const file = vault.createNote(id, tid ?? '', dailyTitle(now, config.language));
    if (!file) return null;
    const scan = await workScanner.scan(config);
    const lines = dailyLines({
      // Remote: whatever the history panel's last SSH scan found (no scan here).
      entries: [...scan.entries, ...history.remoteEntries()],
      work: scan.work,
      turnFiles: turns.all(),
      projects: config.projects
        .filter((p) => !p.remote)
        .map((p) => ({ id: p.id, name: p.name, root: path.resolve(expand(p.path)) })),
      isNote: (abs) => !!graph.notePath(abs),
      language: config.language,
      now,
    });
    // Through the note helpers: a note that isn't UTF-8 opens read-only and is left alone (no replacement
    // characters), the BOM is kept, and a version written meanwhile isn't overwritten.
    const note = readNote(file);
    if (!note || note.readOnly) return file;
    const next = addToSection(note.text, dailyHeading(config.language), lines);
    if (next !== note.text) writeNote(file, next, note.bom, note.mtime);
    return file;
  });
  // Per-source settings (T69): mine in ~/.aquila/vaults, shared as `.aquila-vault.json` in the folder (only when the
  // user saves them as shared). "Make with Claude" is a hidden `claude -p` (sonnet); smoke reads a canned reply.
  const vault: VaultService = new VaultService({
    dir: isSmoke ? path.join(graphDir, 'vaults') : path.join(APP_DIR, 'vaults'),
    graph,
    lang: () => loadConfig().language,
    run: () =>
      isSmoke
        ? async () =>
            fs.readFileSync(
              path.join(__dirname, '..', '..', 'electron', 'fixtures', 'vault', 'suggest-reply.json'),
              'utf8',
            )
        : runClaudeHaiku(binaryFor('claude'), undefined, 'sonnet'),
    onChanged: (id) => send(IPC.vaultChanged, id),
    projectOf: (abs) => projectOfFile(abs),
  });
  power.onChange(() => graph.setSaver(powerState().saver));
  // Note editor (T67): only notes of enabled sources; watched only while open in the editor.
  const noteWatcher = new NoteWatcher((c) => send(IPC.noteChanged, c));
  notesWatched = noteWatcher;
  // T80: the text each opened note had when the user last looked (~/.aquila/notes-seen, never in the repo).
  const seenStore = new NoteSeenStore(
    isSmoke ? path.join(graphDir, 'notes-seen') : path.join(APP_DIR, 'notes-seen'),
  );
  const noteSeen = new NoteSeen({ store: seenStore, read: (f) => readNote(f), turnFiles: () => turns.all() });
  app.on('will-quit', () => {
    noteWatcher.close();
    seenStore.flush();
    graph.close();
    turns.flush();
    if (isSmoke) fs.rmSync(graphDir, { recursive: true, force: true });
  });
  ipcMain.handle(IPC.graphStatus, () => graph.status());
  ipcMain.handle(IPC.graphAddSource, (_e, p: string) => graph.add(String(p)));
  ipcMain.handle(IPC.graphRemoveSource, (_e, id: string) => graph.remove(String(id)));
  ipcMain.handle(IPC.graphSetSourceEnabled, (_e, { id, enabled }: { id: string; enabled: boolean }) =>
    graph.setEnabled(String(id), !!enabled),
  );
  ipcMain.handle(IPC.graphIndexNow, (_e, id: string) => graph.indexNow(String(id)));
  ipcMain.handle(IPC.graphSnapshot, (_e, opts?: { notesOnly?: boolean }) =>
    graph.snapshot({ app: opts?.notesOnly !== true }),
  );
  // T68: decisions and rules go to the index worker; the only file write is an asked-for `[[link]]` at the end of a
  // note of an enabled source (refused when the note isn't plain UTF-8).
  ipcMain.handle(IPC.graphDecide, (_e, d: GraphDecision) => {
    if (typeof d?.source !== 'string' || typeof d?.target !== 'string') return { inserted: false };
    graph.decide({ source: d.source, target: d.target, accept: !!d.accept });
    if (!d.accept || typeof d.insertInto !== 'string' || typeof d.linkTo !== 'string')
      return { inserted: false };
    const file = graph.notePath(d.insertInto);
    const note = file && linkable(d.linkTo) ? readNote(file) : null;
    if (!file || !note || note.readOnly) return { inserted: false };
    const next = withLink(note.text, d.linkTo);
    if (next === null) return { inserted: true };
    return { inserted: writeNote(file, next, note.bom, note.mtime).ok };
  });
  ipcMain.handle(IPC.graphRule, (_e, op: GraphRuleOp) => graph.rule(op));
  ipcMain.handle(IPC.graphSetSourceAi, (_e, { id, ai }: { id: string; ai: boolean }) =>
    graph.setAi(String(id), !!ai),
  );
  ipcMain.handle(IPC.graphExtractNow, (_e, id: string) => graph.extractNow(String(id)));
  ipcMain.handle(IPC.graphOpenNote, async (_e, p: string) => {
    const file = graph.notePath(String(p));
    return !!file && (await shell.openPath(file)) === '';
  });
  ipcMain.handle(IPC.noteOpen, (_e, p: string) => {
    const file = graph.notePath(String(p));
    const note = file ? readNote(file) : null;
    if (file && note) {
      noteWatcher.watch(file);
      void noteSeen.opened(file, note).catch(() => undefined);
    }
    return note;
  });
  ipcMain.on(IPC.noteClose, (_e, p: string) => noteWatcher.unwatch(path.resolve(String(p))));
  ipcMain.handle(
    IPC.noteWrite,
    (_e, a: { path: string; text: string; bom: boolean; baseMtime: number }): NoteWriteResult => {
      const file = graph.notePath(String(a.path));
      if (!file || typeof a.text !== 'string') return { ok: false, reason: 'refused' };
      const res = writeNote(file, a.text, !!a.bom, Number(a.baseMtime));
      // T80: the user's own edit isn't an outside change.
      if (res.ok) noteSeen.saved(file, a.text, !!a.bom, Number(a.baseMtime), res.mtime);
      return res;
    },
  );
  ipcMain.handle(IPC.noteSeenState, (_e, p: string) => {
    const file = graph.notePath(String(p));
    return file ? noteSeen.state(file) : null;
  });
  ipcMain.handle(IPC.noteSeenMark, (_e, p: string) => {
    const file = graph.notePath(String(p));
    return !!file && noteSeen.mark(file);
  });
  ipcMain.handle(IPC.noteSeenChanged, () => noteSeen.changed((f) => !!graph.notePath(f)));
  ipcMain.handle(IPC.noteOpenUrl, (_e, url: string) => {
    if (typeof url === 'string' && isWebUrl(url)) void shell.openExternal(url);
  });
  ipcMain.handle(
    IPC.noteProject,
    (_e, p: string) => (typeof p === 'string' && p ? projectOfFile(p) : null) ?? null,
  );
  protocol.handle('aquila-note', (req) => {
    const p = imageUrlPath(req.url);
    const file = p ? graph.sourceFile(p, IMAGE_FILE) : null;
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 });
  });
  ipcMain.handle(IPC.noteAttach, (_e, a: { notePath: string; data: Uint8Array; ext: string }) => {
    const file = graph.notePath(String(a.notePath));
    return file && a.data instanceof Uint8Array ? saveAttachment(file, a.data, String(a.ext)) : null;
  });
  ipcMain.handle(IPC.vaultGet, (_e, id: string) => vault.state(String(id)));
  ipcMain.handle(IPC.vaultSave, (_e, a: { id: string; config: VaultConfig; scope: VaultScope }) =>
    vault.save(String(a.id), a.config, a.scope === 'shared' ? 'shared' : 'personal'),
  );
  ipcMain.handle(IPC.vaultRemovePersonal, (_e, id: string) => vault.removePersonal(String(id)));
  ipcMain.handle(IPC.vaultPreset, (_e, p: VaultPresetId) => vault.preset(p));
  ipcMain.handle(IPC.vaultSuggest, (_e, a: { id: string; description: string }) =>
    vault.suggest(String(a.id), String(a.description ?? '')),
  );
  ipcMain.handle(IPC.vaultView, (_e, a: { id: string; viewId: string }) =>
    vault.view(String(a.id), String(a.viewId)),
  );
  ipcMain.handle(IPC.vaultMove, (_e, a: { path: string; viewId: string; group: string }) =>
    vault.move(String(a.path), String(a.viewId), String(a.group)),
  );
  ipcMain.handle(IPC.vaultNoteInfo, (_e, p: string) => vault.noteInfo(String(p)));
  // T78: the table view's rows straight from the index; property types from the source's settings when it has some.
  ipcMain.handle(IPC.noteTable, async (_e, id: string): Promise<NoteTableData | null> => {
    const sid = String(id);
    if (!graph.sourceRoot(sid)) return null;
    const notes = await graph.notes(sid);
    let properties: VaultProperty[] = [];
    try {
      properties = vault.state(sid).config.properties;
    } catch {
      // settings unreadable: plain text columns
    }
    return {
      sourceId: sid,
      notes: notes.map((n) => ({ path: n.abs, rel: n.rel, title: n.title, props: n.frontmatter, mtime: n.mtime })),
      properties,
    };
  });
  ipcMain.handle(IPC.vaultEdit, (_e, a: { path: string; text: string; edit: VaultEdit }) =>
    a?.edit && typeof a.edit === 'object' ? vault.edit(String(a.path), a.text, a.edit) : null,
  );
  ipcMain.handle(IPC.vaultCreateNote, (_e, a: { id: string; templateId: string | null; title: string }) =>
    vault.createNote(String(a.id), a.templateId ? String(a.templateId) : null, String(a.title ?? '')),
  );
  ipcMain.handle(IPC.sessionRestore, () => restoreSessions());
  ipcMain.handle(IPC.sessionStart, (_e, id: string) => s.wake(loadConfig(), id));
  ipcMain.handle(IPC.sessionReopen, (_e, id: string) => s.reopen(loadConfig(), String(id)));
  ipcMain.on(IPC.layoutSave, (_e, layout: SavedLayout) => {
    if (isSmoke) return;
    layoutByKey = mapLayout(layout, (id) => s.keyOf(id) ?? null);
    s.saveTabs();
  });
  ipcMain.on(IPC.sessionReorder, (_e, ids: unknown) => {
    if (Array.isArray(ids)) s.reorder(ids.filter((id): id is string => typeof id === 'string'));
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
        graph.projectsChanged(); // T73: its folder joins the graph
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
    accelerator === null || typeof accelerator === 'string'
      ? shortcut.set(accelerator)
      : shortcut.state('invalid'),
  );
  app.on('will-quit', () => shortcut.dispose());

  createWindow();
  // Extensions (T71): floating windows reopen where they were and background ones start with the page (a reload
  // closed them).
  win?.webContents.on('did-finish-load', () => extensions?.restore());
  // T27: notify when a newer release is out (packaged builds only).
  if (app.isPackaged && !isSmoke && !process.env.AQUILA_CAPTURE)
    safe('updater', () => startUpdater(() => translator(loadConfig().language)));
  if (isSmoke && win) {
    const w = win;
    w.webContents.once('did-finish-load', () => runSmoke(w, s, loadConfig(), smokeOutput, previews, runs, extensions));
  }
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
// Hold the quit until the ptys have exited (bounded): exiting earlier can abort in node-pty (see exitWait.ts).
let ptysDone = false;
app.on('before-quit', (e) => {
  if (ptysDone || !sessions) return;
  e.preventDefault();
  quitting = true; // runs.json keeps what was up; stopping them now must not empty it
  // Runs (T60) are detached process groups: quitting must stop them, or a dev server outlives the app.
  void Promise.allSettled([sessions.killAll(), runs?.stopAll()]).finally(() => {
    ptysDone = true;
    app.quit();
  });
});
