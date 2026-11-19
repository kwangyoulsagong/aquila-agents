// Main process: window, config, pty sessions, Claude hook receiver.
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } from 'electron';
import { restoreShellPath } from './env';
import { accountsStatus, installShellFunction, prepareAccount, shellFunctionPreview } from './accounts';
import { CONFIG_PATH, editProjects, loadConfig, setLanguage, setProjectAccount } from './config';
import { showContextMenu } from './menu';
import { gitChanges } from './git';
import { ensureWorktree, worktreeInfo } from './worktrees';
import { markGuideOffered, readGuideState } from './guide';
import { binaryFor, finishFirstRun, firstRunReport, loadOverrides, setBinaryPath } from './detect';
import { detectClaudeVersion, startHookServer, supportsHttpHooks, writeClaudeHookSettings } from './hooks';
import { PowerWatcher, type PowerSource } from './power';
import { SessionManager } from './sessions';
import {
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
import {
  IPC,
  type ContextMenuItem,
  type Language,
  type ProjectEdit,
  type RestoreResult,
  type SavedLayout,
  type SessionInfo,
  type SessionKind,
  type ToolId,
} from '../src/shared/api/types';

const isDev = process.env.AQUILA_DEV === '1';
let win: BrowserWindow | null = null;
let sessions: SessionManager | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0e1014', // = --p-slate-950; avoids a white flash before CSS loads
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
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
  win.webContents.on('did-start-loading', () => sessions?.resetFlow());
  win.on('closed', () => (win = null));
}

app.whenReady().then(async () => {
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
  const hookPort = await startHookServer((tabId, hook) => sessions?.onHook(tabId, hook));
  const hookFiles = writeClaudeHookSettings(hookPort);
  // http hooks unless `claude --version` says it's older than they need (then command + curl).
  let httpHooks = true;
  const detectHooks = () =>
    detectClaudeVersion(process.env, binaryFor('claude')).then((v) => (httpHooks = supportsHttpHooks(v)));
  void detectHooks();
  const smokeOutput = { buffer: '', statuses: [] as string[] };
  const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);
  sessions = new SessionManager({
    send: isSmoke
      ? watchOutput(
          send,
          (d) => (smokeOutput.buffer = (smokeOutput.buffer + d).slice(-SMOKE_BUFFER_BYTES)),
          (st) => smokeOutput.statuses.push(st),
        )
      : send,
    getWindow: () => win,
    hookPort,
    hookSettingsPath: () => (httpHooks ? hookFiles.http : hookFiles.legacy),
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
  ipcMain.handle(IPC.configSetLanguage, (_e, language: Language) => setLanguage(language));
  ipcMain.handle(
    IPC.configSetProjectAccount,
    (_e, { projectId, account }: { projectId: string; account: string }) =>
      setProjectAccount(projectId, account),
  );
  ipcMain.handle(IPC.configEditProjects, (_e, edit: ProjectEdit) => editProjects(edit));
  ipcMain.handle(IPC.dialogPickFolder, async () => {
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.uiContextMenu, (e, items: ContextMenuItem[]) =>
    showContextMenu(BrowserWindow.fromWebContents(e.sender), items),
  );
  ipcMain.handle(
    IPC.sessionCreate,
    (_e, { projectId, kind, account }: { projectId: string; kind: SessionKind; account?: string }) =>
      s.create(loadConfig(), projectId, kind, account),
  );
  ipcMain.handle(
    IPC.sessionCreateWorktree,
    async (_e, { projectId, branch, kind }: { projectId: string; branch: string; kind: SessionKind }) => {
      const config = loadConfig();
      const worktree = await ensureWorktree(config, projectId, branch);
      return s.create(config, projectId, kind, undefined, {}, worktree);
    },
  );
  ipcMain.handle(IPC.worktreeInfo, (_e, projectId: string) => worktreeInfo(loadConfig(), projectId));
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
  ipcMain.handle(
    IPC.gitChanges,
    (_e, { projectId, sessionId }: { projectId: string; sessionId?: string }) =>
      gitChanges(loadConfig(), projectId, sessionId ? s.worktreeOf(sessionId, projectId) : undefined),
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
  ipcMain.on(IPC.sessionWrite, (_e, { id, data }: { id: string; data: string }) => s.write(id, data));
  ipcMain.on(IPC.sessionResize, (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) =>
    s.resize(id, cols, rows),
  );
  ipcMain.on(IPC.sessionKill, (_e, { id }: { id: string }) => s.kill(id));
  ipcMain.on(IPC.sessionSeen, (_e, { id }: { id: string }) => s.markSeen(id));
  ipcMain.on(IPC.uiActive, (_e, { id }: { id: string | null }) => s.setActive(id));
  ipcMain.on(IPC.sessionAck, (_e, { id }: { id: string }) => s.ack(id));
  ipcMain.on(IPC.sessionVisible, (_e, { id, visible }: { id: string; visible: boolean }) =>
    s.setVisible(id, visible),
  );

  createWindow();
  if (isSmoke && win) {
    const w = win;
    w.webContents.once('did-finish-load', () => runSmoke(w, s, loadConfig(), smokeOutput));
  }
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => sessions?.killAll());
