// Preload of an extension view (T71). Sandboxed: only `ipcRenderer` from electron, nothing on `window`, no Node.
// Bridges the page's postMessage API to main: `{ aquila: 'request', id, method, params }` in, `{ aquila: 'response',
// id, result | error }` and `{ aquila: 'event', name, data }` out. Main decides what each extension may call.
// The channel names equal EXT_REQUEST / EXT_EVENT in extensions.ts (a sandboxed preload can't import other files).
import { ipcRenderer } from 'electron';

const REQUEST = 'ext:request';
const EVENT = 'ext:event';

/** The bits of the page's window we use (the electron tsconfig has no DOM lib). */
interface PageWindow {
  addEventListener(type: 'message', cb: (e: { source: unknown; data: unknown }) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
}
const page = globalThis as unknown as PageWindow;

const post = (message: unknown) => page.postMessage(message, '*');

page.addEventListener('message', (e) => {
  const m = e.data as { aquila?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
  if (e.source !== page || !m || typeof m !== 'object' || m.aquila !== 'request') return;
  const id = m.id;
  ipcRenderer.invoke(REQUEST, m.method, m.params).then(
    (result: unknown) => post({ aquila: 'response', id, result }),
    (err: unknown) =>
      post({
        aquila: 'response',
        id,
        // Electron prefixes "Error invoking remote method '…': Error: " — the page only needs the reason.
        error: String((err as Error)?.message ?? err).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          '',
        ),
      }),
  );
});

ipcRenderer.on(EVENT, (_e, name: unknown, data: unknown) => post({ aquila: 'event', name, data }));
