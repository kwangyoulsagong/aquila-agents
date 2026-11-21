// The only bridge between renderer and main. Shape is defined by AquilaApi in src/shared/api/types.ts.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type AquilaApi } from '../src/shared/api/types';
import { platformInfo } from './platform/os';

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
  platform: platformInfo(),
  getConfig: () => ipcRenderer.invoke(IPC.configGet),
  openConfig: () => ipcRenderer.invoke(IPC.configOpen),
  setLanguage: (language) => ipcRenderer.invoke(IPC.configSetLanguage, language),
  setNotifyDone: (on) => ipcRenderer.invoke(IPC.configSetNotifyDone, on),
  setProjectAccount: (projectId, account) =>
    ipcRenderer.invoke(IPC.configSetProjectAccount, { projectId, account }),
  editProjects: (edit) => ipcRenderer.invoke(IPC.configEditProjects, edit),
  pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder),
  projectForPath: (path) => ipcRenderer.invoke(IPC.configProjectForPath, path),
  openProjectIn: (projectId) => ipcRenderer.invoke(IPC.projectOpenIn, projectId),
  showContextMenu: (items) => ipcRenderer.invoke(IPC.uiContextMenu, items),
  createSession: (projectId, kind, account) =>
    ipcRenderer.invoke(IPC.sessionCreate, { projectId, kind, account }),
  createWorktreeSession: (projectId, branch, kind) =>
    ipcRenderer.invoke(IPC.sessionCreateWorktree, { projectId, branch, kind }),
  worktreeInfo: (projectId) => ipcRenderer.invoke(IPC.worktreeInfo, projectId),
  worktreeCandidates: (projectId) => ipcRenderer.invoke(IPC.worktreeCandidates, projectId),
  removeWorktree: (projectId, path) => ipcRenderer.invoke(IPC.worktreeRemove, { projectId, path }),
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
  historyRefreshRemote: () => ipcRenderer.invoke(IPC.historyRefreshRemote),
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
  releaseNotesState: () => ipcRenderer.invoke(IPC.releaseNotesGet),
  markReleaseNotesSeen: (version) => ipcRenderer.invoke(IPC.releaseNotesSeen, version),
  pathForFile: (file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
  copyText: (text) => ipcRenderer.send(IPC.clipboardWrite, text),
  clipboardPaths: () => ipcRenderer.invoke(IPC.clipboardPaths),
  clipboardText: () => ipcRenderer.invoke(IPC.clipboardText),
  lastReply: (sessionId) => ipcRenderer.invoke(IPC.sessionLastReply, sessionId),
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
  renameSession: (id, title) => ipcRenderer.send(IPC.sessionRename, { id, title }),
  onTitle: on(IPC.sessionTitle),
  sshHosts: () => ipcRenderer.invoke(IPC.remoteHosts),
  checkRemote: (host) => ipcRenderer.invoke(IPC.remoteCheck, host),
  reconnect: (id) => ipcRenderer.send(IPC.remoteReconnect, id),
  onConnection: on(IPC.sessionConnection),
  powerState: () => ipcRenderer.invoke(IPC.powerGet),
  onPower: on(IPC.powerChanged),
  usage: () => ipcRenderer.invoke(IPC.usageGet),
  onUsage: on(IPC.usageChanged),
  contextUsage: () => ipcRenderer.invoke(IPC.contextGet),
  onContext: on(IPC.contextChanged),
  figmaProfiles: () => ipcRenderer.invoke(IPC.figmaProfiles),
  figmaConnect: (account) => ipcRenderer.invoke(IPC.figmaConnect, account),
  figmaOpenDocs: () => ipcRenderer.invoke(IPC.figmaOpenDocs),
  previewTargets: (projectId, worktree) => ipcRenderer.invoke(IPC.previewTargets, projectId, worktree),
  onPreviewTargets: on(IPC.previewTargetsChanged),
  previewSet: (slot, state) => ipcRenderer.send(IPC.previewSet, { slot, state }),
  previewCommand: (slot, command) => ipcRenderer.send(IPC.previewCommand, { slot, command }),
  onPreviewNav: on(IPC.previewNav),
  previewPick: (slot) => ipcRenderer.invoke(IPC.previewPick, slot),
  previewPickCancel: (slot) => ipcRenderer.send(IPC.previewPickCancel, slot),
  news: () => ipcRenderer.invoke(IPC.newsGet),
  onNews: on(IPC.newsChanged),
  newsRefresh: () => ipcRenderer.invoke(IPC.newsRefresh),
  newsOpened: () => ipcRenderer.send(IPC.newsOpened),
  newsOpen: (url) => ipcRenderer.send(IPC.newsOpen, url),
  newsSummarize: (language, account) => ipcRenderer.invoke(IPC.newsSummarize, { language, account }),
  globalShortcut: () => ipcRenderer.invoke(IPC.globalShortcutGet),
  setGlobalShortcut: (accelerator) => ipcRenderer.invoke(IPC.globalShortcutSet, accelerator),
  onGlobalShortcut: on(IPC.globalShortcutFired),
  onMenuCommand: on(IPC.menuCommand),
};

contextBridge.exposeInMainWorld('aquila', api);
