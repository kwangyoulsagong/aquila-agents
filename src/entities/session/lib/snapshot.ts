// Plain-text snapshot of a terminal (T21): what a tab shows read-only after a relaunch when it can't resume.
// Plain text on purpose — replaying raw escape sequences from the middle of a TUI's output draws garbage.

/** The part of xterm's `IBuffer` this needs (kept minimal so it's testable without a DOM). */
export interface BufferLike {
  length: number;
  getLine(y: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
}

/** Lines kept per snapshot (the newest). */
export const SNAPSHOT_LINES = 2000;
/** How often changed terminals are snapshotted (ms); slower in power-saver mode. */
export const SNAPSHOT_MS = 10_000;
export const SNAPSHOT_SAVER_MS = 30_000;

/** The buffer's last `maxLines` logical lines (wrapped rows joined), trailing blank lines dropped. */
export function snapshotText(buffer: BufferLike, maxLines = SNAPSHOT_LINES): string {
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-maxLines).join('\n');
}
