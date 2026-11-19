// Routes pty output to the xterm that owns it. One IPC listener for the whole app.
// Output that arrives before a terminal mounts is buffered and flushed on attach.
// Every batch is acknowledged once xterm has written it: main pauses the pty while acks lag (flow control).
import { api } from '@/shared/api';

/** Writes `data` and calls `done` once it has been parsed. */
type Writer = (data: string, done: () => void) => void;

const writers = new Map<string, Writer>();
/** Output received before the terminal mounted. Acked on arrival, so a session never pauses for lack of a view. */
const pending = new Map<string, string>();
const noop = () => {};

api.onData(({ id, data }) => {
  const w = writers.get(id);
  if (w) return w(data, () => api.ackData(id));
  pending.set(id, (pending.get(id) ?? '') + data);
  api.ackData(id);
});

export function attach(id: string, write: Writer): () => void {
  writers.set(id, write);
  const buffered = pending.get(id);
  if (buffered) {
    pending.delete(id);
    write(buffered, noop);
  }
  return () => {
    writers.delete(id);
  };
}

/** Pastes into a mounted terminal like ⌘V (bracketed paste when the CLI asked for it) and focuses it. */
const pasters = new Map<string, (text: string) => void>();

export function registerPaste(id: string, paste: (text: string) => void): () => void {
  pasters.set(id, paste);
  return () => {
    if (pasters.get(id) === paste) pasters.delete(id);
  };
}

/** Puts `text` in the session's input without pressing Enter; false when its terminal isn't mounted. */
export function pasteIntoSession(id: string, text: string): boolean {
  const paste = pasters.get(id);
  if (!paste) return false;
  paste(text);
  return true;
}
