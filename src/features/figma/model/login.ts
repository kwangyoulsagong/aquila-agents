import { api } from '@/shared/api';

/** What the login helper needs from the session API (injected in tests). */
export interface TypeDeps {
  onData: (cb: (p: { id: string; data: string }) => void) => () => void;
  write: (id: string, data: string) => void;
}

export interface TypeTiming {
  /** Output must pause this long (the CLI drew its prompt and waits). */
  quietMs: number;
  /** Type anyway after this long (a quiet CLI, or no output at all). */
  maxMs: number;
}

const TIMING: TypeTiming = { quietMs: 1200, maxMs: 10_000 };

/**
 * Types `text` into a freshly opened tab once its CLI has settled: after its first output, when output pauses for
 * `quietMs` (or after `maxMs`). No Enter: the user reads it and sends (T54 "Log in from Claude" types `/mcp`; if Claude
 * first asks "Trust this folder?", the letters don't answer it). Resolves when typed.
 */
export function typeWhenSettled(
  id: string,
  text: string,
  deps: TypeDeps = api,
  timing: TypeTiming = TIMING,
): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      off();
      clearTimeout(quiet);
      clearTimeout(cap);
      deps.write(id, text);
      resolve();
    };
    const off = deps.onData((p) => {
      if (p.id !== id) return;
      clearTimeout(quiet);
      quiet = setTimeout(finish, timing.quietMs);
    });
    const cap = setTimeout(finish, timing.maxMs);
  });
}

/** What "Log in from Claude" types: Claude's MCP menu, where figma → Authenticate starts the browser login. */
export const LOGIN_COMMAND = '/mcp';
