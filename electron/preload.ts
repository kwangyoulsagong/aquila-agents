// The only bridge between renderer and main. Shape is defined by AquilaApi in src/shared/api/types.ts.
import { contextBridge, ipcRenderer } from 'electron';
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
  createSession: (projectId, kind, account) =>
    ipcRenderer.invoke(IPC.sessionCreate, { projectId, kind, account }),
  restoreSessions: () => ipcRenderer.invoke(IPC.sessionRestore),
  accountsStatus: () => ipcRenderer.invoke(IPC.accountsStatus),
  prepareAccount: (account) => ipcRenderer.invoke(IPC.accountsPrepare, account),
  shellFunctionPreview: (account) => ipcRenderer.invoke(IPC.accountsShellPreview, account),
  installShellFunction: (account) => ipcRenderer.invoke(IPC.accountsShellInstall, account),
  gitChanges: (projectId) => ipcRenderer.invoke(IPC.gitChanges, projectId),
  write: (id, data) => ipcRenderer.send(IPC.sessionWrite, { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send(IPC.sessionResize, { id, cols, rows }),
  kill: (id) => ipcRenderer.send(IPC.sessionKill, { id }),
  markSeen: (id) => ipcRenderer.send(IPC.sessionSeen, { id }),
  setActive: (id) => ipcRenderer.send(IPC.uiActive, { id }),
  onData: on(IPC.sessionData),
  onStatus: on(IPC.sessionStatus),
  onExit: on(IPC.sessionExit),
  onFocusSession: on(IPC.uiFocusSession),
};

contextBridge.exposeInMainWorld('aquila', api);
