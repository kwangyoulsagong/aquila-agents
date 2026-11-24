import { api } from '@/shared/api';
import { safePasteText } from '@/shared/lib/pasteText';

export interface PasteDeps {
  onData: (cb: (p: { id: string; data: string }) => void) => () => void;
  write: (id: string, data: string) => void;
}

export interface PasteTiming {
  /** Output must pause this long (the CLI drew its prompt and waits). */
  quietMs: number;
  /** Paste anyway after this long, unless Claude is asking to trust the folder. */
  maxMs: number;
  /** Give up waiting for the trust answer after this long (the steps are not pasted). */
  trustMs: number;
}

const TIMING: PasteTiming = { quietMs: 1200, maxMs: 10_000, trustMs: 10 * 60_000 };

/**
 * Claude's "Quick safety check: … trust this folder?" — a new worktree is a folder Claude hasn't seen. Matched with
 * whitespace and escapes removed: the TUI draws words with cursor moves, not spaces.
 */
const TRUST = /trustthisfolder|doyoutrust|이폴더를신뢰/i;
const plain = (s: string) =>
  s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[=>()][0-9A-Za-z]?/g, '') // eslint-disable-line no-control-regex
    .replace(/\s+/g, '')
    .toLowerCase();

/**
 * Pastes `text` (bracketed, no Enter: the user reads it and sends) into a new Claude tab once it waits for input:
 * when its output pauses. If Claude first asks to trust the folder, the paste waits until the user answered and
 * the prompt was drawn, so the steps don't land in the trust menu. Resolves true when pasted.
 */
export function pasteWhenReady(
  id: string,
  text: string,
  deps: PasteDeps = api,
  timing: PasteTiming = TIMING,
): Promise<boolean> {
  return new Promise((resolve) => {
    let seen = '';
    let trusting = false;
    let done = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const finish = (paste: boolean) => {
      if (done) return;
      done = true;
      off();
      clearTimeout(quiet);
      clearTimeout(cap);
      clearTimeout(trustCap);
      // Through safe paste (T40): trend text comes from feeds, and an `ESC[201~` in it would end the paste early.
      if (paste) deps.write(id, `\x1b[200~${safePasteText(text)}\x1b[201~`);
      resolve(paste);
    };
    const settled = () => {
      if (TRUST.test(seen)) {
        // Asking: wait for the answer (new output after it), whatever the cap says.
        trusting = true;
        seen = '';
        return;
      }
      if (trusting && !seen) return;
      finish(true);
    };
    const off = deps.onData((p) => {
      if (p.id !== id) return;
      seen = (seen + plain(p.data)).slice(-4000);
      clearTimeout(quiet);
      quiet = setTimeout(settled, timing.quietMs);
    });
    const cap = setTimeout(() => {
      if (!trusting && !TRUST.test(seen)) finish(true);
    }, timing.maxMs);
    const trustCap = setTimeout(() => finish(false), timing.trustMs);
  });
}
