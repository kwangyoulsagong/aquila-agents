// The only bridge between renderer and main. Shape is defined by AquilaApi in src/shared/api/types.ts.
import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type AquilaApi } from '../src/shared/api/types';

const on =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const listener = (_e: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

const api: AquilaApi = {
  getConfig: () => ipcRenderer.invoke(IPC.configGet),
  openConfig: () => ipcRenderer.invoke(IPC.configOpen),
  setLanguage: (language) => ipcRenderer.invoke(IPC.configSetLanguage, language),
  setProjectAccount: (projectId, account) =>
    ipcRenderer.invoke(IPC.configSetProjectAccount, { projectId, account }),
  editProjects: (edit) => ipcRenderer.invoke(IPC.configEditProjects, edit),
  pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder),
  showContextMenu: (items) => ipcRenderer.invoke(IPC.uiContextMenu, items),
  createSession: (projectId, kind, account) =>
    ipcRenderer.invoke(IPC.sessionCreate, { projectId, kind, account }),
  createWorktreeSession: (projectId, branch, kind) =>
    ipcRenderer.invoke(IPC.sessionCreateWorktree, { projectId, branch, kind }),
  worktreeInfo: (projectId) => ipcRenderer.invoke(IPC.worktreeInfo, projectId),
  restoreSessions: () => ipcRenderer.invoke(IPC.sessionRestore),
  startSession: (id) => ipcRenderer.invoke(IPC.sessionStart, id),
  saveLayout: (layout) => ipcRenderer.send(IPC.layoutSave, layout),
  saveScrollback: (id, text) => ipcRenderer.send(IPC.sessionScrollback, { id, text }),
  accountsStatus: () => ipcRenderer.invoke(IPC.accountsStatus),
  prepareAccount: (account) => ipcRenderer.invoke(IPC.accountsPrepare, account),
  shellFunctionPreview: (account) => ipcRenderer.invoke(IPC.accountsShellPreview, account),
  installShellFunction: (account) => ipcRenderer.invoke(IPC.accountsShellInstall, account),
  gitChanges: (projectId, sessionId, scope) =>
    ipcRenderer.invoke(IPC.gitChanges, { projectId, sessionId, scope }),
  gitWatch: (target) => ipcRenderer.send(IPC.gitWatch, target),
  onGitChanged: on(IPC.gitChanged),
  gitAction: (action) => ipcRenderer.invoke(IPC.gitAction, action),
  historyList: () => ipcRenderer.invoke(IPC.historyList),
  historySearch: (query) => ipcRenderer.invoke(IPC.historySearch, query),
  historyTranscript: (ref) => ipcRenderer.invoke(IPC.historyTranscript, ref),
  historySetMeta: (ref, change) => ipcRenderer.invoke(IPC.historySetMeta, { ref, change }),
  historyExport: (ref) => ipcRenderer.invoke(IPC.historyExport, ref),
  historyResume: (ref, addProject) => ipcRenderer.invoke(IPC.historyResume, { ref, addProject: addProject === true }),
  firstRun: (recheck) => ipcRenderer.invoke(IPC.firstRunGet, recheck === true),
  finishFirstRun: () => ipcRenderer.invoke(IPC.firstRunFinish),
  pickBinary: (tool) => ipcRenderer.invoke(IPC.firstRunPickBinary, tool),
  resetBinary: (tool) => ipcRenderer.invoke(IPC.firstRunResetBinary, tool),
  guideState: () => ipcRenderer.invoke(IPC.guideGet),
  markGuideOffered: () => ipcRenderer.invoke(IPC.guideOffered),
  pathForFile: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
  copyText: (text) => clipboard.writeText(text),
  write: (id, data) => ipcRenderer.send(IPC.sessionWrite, { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send(IPC.sessionResize, { id, cols, rows }),
  kill: (id) => ipcRenderer.send(IPC.sessionKill, { id }),
  markSeen: (id) => ipcRenderer.send(IPC.sessionSeen, { id }),
  setActive: (id) => ipcRenderer.send(IPC.uiActive, { id }),
  ackData: (id) => ipcRenderer.send(IPC.sessionAck, { id }),
  setVisible: (id, visible) => ipcRenderer.send(IPC.sessionVisible, { id, visible }),
  onData: on(IPC.sessionData),
  onStatus: on(IPC.sessionStatus),
  onExit: on(IPC.sessionExit),
  onFocusSession: on(IPC.uiFocusSession),
  powerState: () => ipcRenderer.invoke(IPC.powerGet),
  onPower: on(IPC.powerChanged),
};

contextBridge.exposeInMainWorld('aquila', api);
