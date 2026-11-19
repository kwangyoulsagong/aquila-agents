// Main process: window, config, pty sessions, Claude hook receiver.
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { restoreShellPath } from './env';
import { accountsStatus, installShellFunction, prepareAccount, shellFunctionPreview } from './accounts';
import { CONFIG_PATH, editProjects, loadConfig, setLanguage, setProjectAccount } from './config';
import { showContextMenu } from './menu';
import { gitChanges } from './git';
import { startHookServer, writeClaudeHookSettings } from './hooks';
import { SessionManager } from './sessions';
import { planRestore, readState, writeState, type SavedTab } from './state';
import { isSmoke, runSmoke, watchOutput } from './smoke';
import {
  IPC,
  type ContextMenuItem,
  type Language,
  type ProjectEdit,
  type SessionInfo,
  type SessionKind,
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
  win.on('closed', () => (win = null));
}

app.whenReady().then(async () => {
  await restoreShellPath(); // Finder launches get a minimal PATH
  // Read before any session exists: the first create/exit rewrites state.json. Smoke never touches it.
  const savedTabs = isSmoke ? [] : readState();
  const saveTabs = (tabs: SavedTab[]) => {
    try {
      writeState(tabs);
    } catch (err) {
      console.error('[state] save failed', err);
    }
  };
  const hookPort = await startHookServer(
    (tabId, status) => sessions?.onHook(tabId, status),
    (tabId, claudeSessionId) => sessions?.onClaudeSession(tabId, claudeSessionId),
  );
  const smokeOutput = { buffer: '' };
  const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);
  sessions = new SessionManager({
    send: isSmoke ? watchOutput(send, (d) => (smokeOutput.buffer += d)) : send,
    getWindow: () => win,
    hookPort,
    hookSettingsPath: writeClaudeHookSettings(),
    onTabsChanged: isSmoke ? undefined : saveTabs,
  });
  const s = sessions;

  let restored: SessionInfo[] | null = null;
  const restoreSessions = (): SessionInfo[] => {
    if (!restored) {
      const config = loadConfig();
      restored = planRestore(savedTabs, config).flatMap((plan) => {
        try {
          return [s.create(config, plan.projectId, plan.kind, plan.account, plan)];
        } catch (err) {
          console.error('[state] restore failed', plan, err);
          return [];
        }
      });
    }
    return restored.filter((info) => s.has(info.id));
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
  ipcMain.handle(IPC.sessionRestore, () => restoreSessions());
  ipcMain.handle(IPC.accountsStatus, () => accountsStatus(loadConfig()));
  ipcMain.handle(IPC.accountsPrepare, (_e, account: string) => prepareAccount(loadConfig(), account));
  ipcMain.handle(IPC.accountsShellPreview, (_e, account: string) =>
    shellFunctionPreview(loadConfig(), account),
  );
  ipcMain.handle(IPC.accountsShellInstall, (_e, account: string) =>
    installShellFunction(loadConfig(), account),
  );
  ipcMain.handle(IPC.gitChanges, (_e, projectId: string) => gitChanges(loadConfig(), projectId));
  ipcMain.on(IPC.sessionWrite, (_e, { id, data }: { id: string; data: string }) => s.write(id, data));
  ipcMain.on(IPC.sessionResize, (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) =>
    s.resize(id, cols, rows),
  );
  ipcMain.on(IPC.sessionKill, (_e, { id }: { id: string }) => s.kill(id));
  ipcMain.on(IPC.sessionSeen, (_e, { id }: { id: string }) => s.markSeen(id));
  ipcMain.on(IPC.uiActive, (_e, { id }: { id: string | null }) => s.setActive(id));

  createWindow();
  if (isSmoke && win) {
    const w = win;
    w.webContents.once('did-finish-load', () => runSmoke(w, s, loadConfig(), smokeOutput));
  }
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => sessions?.killAll());
