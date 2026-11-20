// Waiting for ptys to exit before the app does.
//
// node-pty watches each child on its own thread and, when it dies, calls the JS `onExit` on the main thread
// through a thread-safe function. If the app exits while that call is still queued, the call lands in a Node
// environment that's being torn down, node-addon-api throws `Napi::Error` from native code, nothing catches it
// and the process aborts (`libc++abi: terminating due to uncaught exception of type Napi::Error`, SIGABRT).
// So: kill, then wait until every `onExit` has run (bounded), and only then exit.

/** The part of a pty this needs (node-pty's `IPty`). */
export interface Exitable {
  onExit: (listener: () => void) => { dispose: () => void };
  kill: (signal?: string) => void;
}

export interface ExitWaitOptions {
  /** How long to wait for a normal exit after the first kill. */
  graceMs?: number;
  /** After SIGKILL, how long to wait before giving up (the app exits anyway). */
  forceMs?: number;
  /** Signal for stragglers; leave it out on Windows (no signals there: plain `kill()`). */
  forceSignal?: string;
}

/**
 * Resolves once every pty has exited — or, for stragglers, after SIGKILL and `forceMs` more. Never rejects.
 * Call it right after the ptys were sent their first kill (the listeners are attached synchronously, so an exit
 * can't slip in between).
 */
export function waitForExits(
  procs: readonly Exitable[],
  { graceMs = 1500, forceMs = 300, forceSignal }: ExitWaitOptions = {},
): Promise<void> {
  if (!procs.length) return Promise.resolve();
  const pending = new Set(procs);
  const subs: { dispose: () => void }[] = [];
  return new Promise<void>((resolve) => {
    let force: ReturnType<typeof setTimeout> | undefined;
    const grace = setTimeout(() => {
      for (const p of pending)
        try {
          p.kill(forceSignal);
        } catch {
          // gone in the meantime
        }
      force = setTimeout(done, forceMs);
    }, graceMs);
    function done() {
      clearTimeout(grace);
      clearTimeout(force);
      for (const s of subs) s.dispose();
      resolve();
    }
    for (const p of procs)
      subs.push(
        p.onExit(() => {
          pending.delete(p);
          if (!pending.size) done();
        }),
      );
  });
}
