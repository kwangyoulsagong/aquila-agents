// Routes pty output to the xterm that owns it. One IPC listener for the whole app.
// Output that arrives before a terminal mounts is buffered and flushed on attach.
import { api } from '@/shared/api';

type Writer = (data: string) => void;

const writers = new Map<string, Writer>();
const pending = new Map<string, string>();

api.onData(({ id, data }) => {
  const w = writers.get(id);
  if (w) w(data);
  else pending.set(id, (pending.get(id) ?? '') + data);
});

export function attach(id: string, write: Writer): () => void {
  writers.set(id, write);
  const buffered = pending.get(id);
  if (buffered) {
    pending.delete(id);
    write(buffered);
  }
  return () => {
    writers.delete(id);
  };
}
