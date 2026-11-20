// ConPTY on Windows misbehaves when several ptys are killed at once (hangs, leftover conhost.exe), and killing
// a pty that already exited throws. Kills go through one queue, a short gap apart; exited ptys are skipped.
// On macOS the gap is 0 and a kill runs right away.

export interface Killable {
  kill(): void;
}

export class KillQueue {
  private queue: { p: Killable; exited: () => boolean }[] = [];
  private timer: unknown = null;

  constructor(
    private gapMs: number,
    private setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {}

  /** `exited` is asked again right before the kill (the pty may exit while queued). */
  kill(p: Killable, exited: () => boolean): void {
    if (this.gapMs <= 0) return safeKill(p, exited);
    this.queue.push({ p, exited });
    if (this.timer === null) this.next();
  }

  get pending(): number {
    return this.queue.length;
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.timer = null;
      return;
    }
    safeKill(item.p, item.exited);
    this.timer = this.setTimer(() => this.next(), this.gapMs);
  }
}

function safeKill(p: Killable, exited: () => boolean): void {
  if (exited()) return;
  try {
    p.kill();
  } catch {
    // exited between the check and the kill
  }
}
