// Batches one session's pty output for IPC and applies renderer back-pressure.
// Many tiny `session:data` messages cost more than the bytes in them (IPC + one xterm write each), and a flood
// like `yes` must not queue megabytes the renderer will spend seconds parsing — that is what makes Ctrl+C feel dead.

/** Flush after this long while the session is on screen (one frame). */
export const VISIBLE_INTERVAL_MS = 16;
/** Off screen nobody watches it paint: fewer, bigger messages. */
export const HIDDEN_INTERVAL_MS = 200;
/** Flush at once when the buffer reaches this size. */
export const MAX_BATCH_BYTES = 64 * 1024;
/** Batches sent but not yet written by xterm: pause the pty at HIGH, resume at LOW. */
export const HIGH_WATER = 5;
export const LOW_WATER = 2;

export interface OutputSink {
  send: (data: string) => void;
  pause: () => void;
  resume: () => void;
}

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
};

export class OutputBatcher {
  private buffer = '';
  private timer: unknown = null;
  private visible = false;
  /** Batches the renderer hasn't acknowledged yet. */
  private inFlight = 0;
  private paused = false;

  constructor(
    private sink: OutputSink,
    private timers: Timers = realTimers,
  ) {}

  push(data: string): void {
    this.buffer += data;
    if (this.buffer.length >= MAX_BATCH_BYTES) this.flush();
    else if (this.timer === null)
      this.timer = this.timers.set(
        () => this.flush(),
        this.visible ? VISIBLE_INTERVAL_MS : HIDDEN_INTERVAL_MS,
      );
  }

  /** Sends whatever is buffered now (also before the exit message, so no output is lost). */
  flush(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    if (!this.buffer) return;
    const data = this.buffer;
    this.buffer = '';
    this.sink.send(data);
    this.inFlight++;
    if (!this.paused && this.inFlight >= HIGH_WATER) {
      this.paused = true;
      this.sink.pause();
    }
  }

  /** xterm finished writing one batch. */
  ack(): void {
    if (this.inFlight > 0) this.inFlight--;
    if (this.paused && this.inFlight <= LOW_WATER) {
      this.paused = false;
      this.sink.resume();
    }
  }

  /** Coming on screen flushes what a hidden session was holding back. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible && this.timer !== null) this.flush();
  }

  /** The renderer reloaded: its acks for what was in flight will never come. */
  resetFlow(): void {
    this.inFlight = 0;
    if (this.paused) {
      this.paused = false;
      this.sink.resume();
    }
  }

  dispose(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.buffer = '';
  }
}
