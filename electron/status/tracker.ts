// One session's status, from (in order of trust): OSC 7501 reports, Claude hooks, keys typed, output activity.
// Pure: time is passed in, nothing is sent from here. SessionManager feeds signals and emits on change.
import { statusOf7501 } from './osc';
import type { ErrorReason, SessionStatus } from '../../src/shared/api/types';

/** Output-activity heuristic (codex without 7501, shell). */
export const QUIET_MS = 3000;
export const MIN_BUSY_MS = 3000;
/** An Esc / Ctrl+C this recent turns the program's next `idle` report into `stopped`. */
export const INTERRUPT_MS = 5000;

/** What a Claude hook told us (from the JSON Claude posts). */
export interface HookSignal {
  event: string;
  /** Notification: permission_prompt, idle_prompt, elicitation_dialog, … */
  notificationType?: string;
  /** SessionEnd: clear, logout, prompt_input_exit, other, … */
  reason?: string;
  /** StopFailure: rate_limit, billing_error, authentication_failed, … */
  error?: string;
}

export interface StatusView {
  status: SessionStatus;
  /** Guessed from output activity (shown dimmed). */
  estimated: boolean;
  /** Why it's `error`, when known. */
  reason?: ErrorReason;
}

/** Notifications that mean "needs you". Never `idle_prompt`: it fires after 60 s of quiet and isn't a question. */
export const WAITING_NOTIFICATIONS = ['permission_prompt', 'elicitation_dialog'];

const URGENCY: SessionStatus[] = ['waiting', 'error', 'working', 'done', 'stopped', 'idle'];

const ERROR_REASONS: Record<string, ErrorReason> = {
  rate_limit: 'rateLimit',
  overloaded: 'server',
  server_error: 'server',
  authentication_failed: 'auth',
  oauth_org_not_allowed: 'auth',
  verification_required: 'auth',
  cloud_credential_error: 'auth',
  billing_error: 'billing',
  account_on_hold: 'billing',
};

export const errorReasonOf = (error: string | undefined): ErrorReason =>
  (error && ERROR_REASONS[error]) || 'other';

/**
 * Terminal replies and reports xterm sends on its own (focus in/out, mouse, DA, cursor position, OSC/DCS answers).
 * They go through the same input path as keys but aren't the user typing.
 */
const NOT_TYPED =
  // eslint-disable-next-line no-control-regex
  /^(?:\x1b\[[IO]|\x1b\[<[\d;]+[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[?>=][\d;]*c|\x1b\[\d+;\d+R|\x1b\[\??[\d;]*\$y|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*?\x1b\\)+$/;

export const isTyped = (data: string): boolean => data.length > 0 && !NOT_TYPED.test(data);

const isInterrupt = (data: string) => data === '\x1b' || data.includes('\x03');

export class StatusTracker {
  private view: StatusView = { status: 'idle', estimated: false };
  /** OSC 7501 records by `id` ('' = the program itself). */
  private records = new Map<string, SessionStatus>();
  /** Most urgent record; null until the program reports (then 7501 decides). */
  private reported: SessionStatus | null = null;
  /** A StopFailure error stays until a new turn starts (a later done/idle report must not hide it). */
  private failed = false;
  private subagents = 0;
  /** Stop arrived while subagents were still running. */
  private stopPending = false;
  private interruptAt = -Infinity;
  private lastOutput = 0;
  private busySince = 0;

  /** `heuristic`: guess working/done from output while the program doesn't report (codex, shell). */
  constructor(private heuristic: boolean) {}

  current(): StatusView {
    return this.view;
  }

  /** True once the program sends OSC 7501 reports. */
  get reporting(): boolean {
    return this.reported !== null;
  }

  /** One OSC 7501 report. Returns true when the view changed. */
  osc(fields: Record<string, string>, now: number): boolean {
    const key = fields.id ?? '';
    if (fields.state === 'clear') {
      if (fields.id === undefined) this.records.clear();
      else this.records.delete(key);
    } else {
      const status = statusOf7501(fields.state);
      if (!status) return false;
      this.records.set(key, status);
    }

    if (this.records.size === 0) {
      // The program cleared everything (it exited): back to hooks / heuristics.
      const was = this.reported;
      this.reported = null;
      return was !== null && this.set('stopped');
    }
    const top = URGENCY.find((s) => [...this.records.values()].includes(s)) ?? 'idle';
    if (top === this.reported) return false;
    this.reported = top;

    if (top === 'idle' && (this.view.status === 'stopped' || now - this.interruptAt < INTERRUPT_MS))
      return this.set('stopped');
    if ((top === 'idle' || top === 'done') && this.failed) return false;
    if (top === 'working' || top === 'waiting') this.failed = false;
    if (top === 'error') return this.set('error', false, 'other');
    return this.set(top);
  }

  /** One Claude hook. 7501 wins for everything but session end and API failures. */
  hook(h: HookSignal): boolean {
    switch (h.event) {
      case 'SessionStart':
        this.subagents = 0;
        this.stopPending = false;
        return false;
      case 'SessionEnd':
        if (h.reason === 'clear') return false;
        this.subagents = 0;
        this.stopPending = false;
        this.failed = false;
        return this.set('stopped');
      case 'StopFailure':
        this.failed = true;
        this.stopPending = false;
        return this.set('error', false, errorReasonOf(h.error));
    }
    if (this.reporting) return false;
    switch (h.event) {
      case 'UserPromptSubmit':
      case 'PostToolUse':
      case 'PermissionDenied':
        this.failed = false;
        return this.set('working');
      case 'PermissionRequest':
        return this.set('waiting');
      case 'Notification':
        return WAITING_NOTIFICATIONS.includes(h.notificationType ?? '') && this.set('waiting');
      case 'SubagentStart':
        this.subagents++;
        return false;
      case 'SubagentStop':
        this.subagents = Math.max(0, this.subagents - 1);
        if (this.subagents > 0 || !this.stopPending) return false;
        this.stopPending = false;
        return this.set('done');
      case 'Stop':
        // A Stop while subagents still run isn't the end of the work.
        if (this.subagents > 0) {
          this.stopPending = true;
          return false;
        }
        return this.set('done');
    }
    return false;
  }

  /** Something was written to the pty from the keyboard path. */
  input(data: string, now: number): boolean {
    if (!isTyped(data)) return false;
    const busy = this.view.status === 'working' || this.view.status === 'waiting';
    const interrupt = isInterrupt(data);
    if (this.reporting) {
      // The program will report what happened; only remember the interrupt to call its `idle` "stopped".
      if (interrupt && busy) this.interruptAt = now;
      return false;
    }
    if (interrupt && busy) {
      this.stopPending = false;
      this.busySince = 0;
      return this.set('stopped');
    }
    // Answered the question / permission: back to work until the next hook says otherwise.
    if (this.view.status === 'waiting') return this.set('working');
    return false;
  }

  output(now: number): void {
    if (!this.heuristic || this.reporting) return;
    if (!this.busySince) this.busySince = now;
    this.lastOutput = now;
  }

  /** Called every second: output-activity heuristic. */
  tick(now: number): boolean {
    if (!this.heuristic || this.reporting || !this.busySince) return false;
    const quiet = now - this.lastOutput > QUIET_MS;
    if (!quiet) {
      return now - this.busySince > MIN_BUSY_MS && this.view.status !== 'working' && this.set('working');
    }
    this.busySince = 0;
    return this.view.status === 'working' && this.set('done', true);
  }

  /** The session is on screen: a finished one becomes idle. */
  seen(): boolean {
    return this.view.status === 'done' && this.set('idle');
  }

  /** The pty exited: 0 / Ctrl+C (130) / killed by a signal = stopped, anything else = error. */
  exit(exitCode: number, signal?: number): boolean {
    const stopped = exitCode === 0 || exitCode === 130 || !!signal;
    return stopped ? this.set('stopped') : this.set('error', false, 'exit');
  }

  private set(status: SessionStatus, estimated = false, reason?: ErrorReason): boolean {
    const v = this.view;
    if (v.status === status && v.estimated === estimated && v.reason === reason) return false;
    this.view = { status, estimated, ...(reason ? { reason } : {}) };
    return true;
  }
}
