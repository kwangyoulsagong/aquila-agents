// OSC 7501 Program Status Protocol (https://control-codes.page/proposals/osc-7501/, rev 0.4).
// Programs ask `OSC 7501 ; ? ST`; a terminal that answers gets reports like
// `OSC 7501 ; state=blocked:app=claude-code:kind=permission:msg=<base64> BEL`.
// Claude Code 2.1.295+ only reports after a reply; Codex 0.170 reports on its own.
import type { SessionStatus } from '../../src/shared/api/types';

const PREFIX = '\x1b]7501;';
/** Spec cap for one sequence, plus the prefix. */
const MAX_SEQUENCE = 4096 + PREFIX.length;

/** Our answer to `OSC 7501 ; ?`: the default capability lists. Must reach the pty before the DA1 reply. */
export const OSC_7501_REPLY = `${PREFIX}?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\`;

export type OscMessage = { type: 'query' } | { type: 'report'; fields: Record<string, string> };

/**
 * Finds OSC 7501 sequences in pty output. Sequences split across chunks are buffered (up to the spec's 4096 bytes).
 * Returns the payloads (what follows `7501;`), in order.
 */
export class OscScanner {
  private pending = '';

  feed(chunk: string): string[] {
    const s = this.pending + chunk;
    this.pending = '';
    // Fast path: nothing that could start an OSC.
    if (!s.includes('\x1b')) return [];
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const start = s.indexOf('\x1b]', from);
      if (start === -1) {
        if (s.endsWith('\x1b')) this.pending = '\x1b';
        break;
      }
      const head = s.slice(start, start + PREFIX.length);
      if (head.length < PREFIX.length) {
        if (PREFIX.startsWith(head)) this.pending = s.slice(start);
        break;
      }
      if (head !== PREFIX) {
        from = start + 2;
        continue;
      }
      const body = start + PREFIX.length;
      const bel = s.indexOf('\x07', body);
      const esc = s.indexOf('\x1b', body);
      const end = bel === -1 ? esc : esc === -1 ? bel : Math.min(bel, esc);
      if (end === -1 || (end === esc && end === s.length - 1)) {
        // Not terminated yet: keep it for the next chunk unless it's already too long.
        if (s.length - start <= MAX_SEQUENCE) this.pending = s.slice(start);
        break;
      }
      // ESC that isn't `ESC \` cancels the sequence.
      if (end === bel || s[end + 1] === '\\') out.push(s.slice(body, end));
      from = end + 1;
    }
    return out;
  }
}

/** `?` = a program asking whether we support the protocol. Anything else with `key=value` pairs is a report. */
export function parse7501(payload: string): OscMessage | null {
  // Only a bare `?` is a query: our own reply (`?:states=…`) echoed back must never trigger another reply.
  if (payload === '?') return { type: 'query' };
  if (payload.startsWith('?')) return null;
  const fields: Record<string, string> = {};
  for (const part of payload.split(':')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    fields[key] = key === 'title' || key === 'msg' ? decodeBase64(value) : value;
  }
  return fields.state ? { type: 'report', fields } : null;
}

function decodeBase64(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const STATE: Record<string, SessionStatus> = {
  idle: 'idle',
  working: 'working',
  blocked: 'waiting',
  done: 'done',
  error: 'error',
};

/** Our status for a reported state; null for `clear` and states we don't know (ignored, per spec). */
export const statusOf7501 = (state: string): SessionStatus | null => STATE[state] ?? null;
