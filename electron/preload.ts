// The only bridge between renderer and main. Shape is defined by AgentrixApi in src/shared/api/types.ts.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AgentrixApi } from '../src/shared/api/types';

const on =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const listener = (_e: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

const api: AgentrixApi = {
  getConfig: () => ipcRenderer.invoke(IPC.configGet),
  openConfig: () => ipcRenderer.invoke(IPC.configOpen),
  setLanguage: (language) => ipcRenderer.invoke(IPC.configSetLanguage, language),
  setProjectAccount: (projectId, account) =>
    ipcRenderer.invoke(IPC.configSetProjectAccount, { projectId, account }),
  createSession: (projectId, kind) => ipcRenderer.invoke(IPC.sessionCreate, { projectId, kind }),
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

contextBridge.exposeInMainWorld('agentrix', api);
