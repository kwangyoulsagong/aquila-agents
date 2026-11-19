// Attention: notification text, when to notify (settle, debounce, one reminder) and the Dock badge.
// The text and timing helpers are pure (time passed in); `Attention` owns the timers and shows notifications.
import { app, Notification } from 'electron';
import { kindLabel, type Translate } from '../src/shared/i18n/dictionary';
import type { ErrorReason, SessionKind, SessionStatus } from '../src/shared/api/types';

/** Wait this long before notifying so a flap (waiting → working → waiting) or a late hook detail settles. */
export const SETTLE_MS = 400;
/** The same status for the same session again within this window isn't notified twice. */
export const DEBOUNCE_MS = 30_000;
/** One reminder when a session has been waiting this long and still isn't on screen. */
export const REMIND_MS = 10 * 60_000;
/** Detail text is cut to this many characters (one line). */
export const DETAIL_MAX = 120;

/** First non-empty line, whitespace collapsed, cut to `max` with an ellipsis. */
export function firstLine(text: string | undefined, max = DETAIL_MAX): string {
  const line = (text ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    // Skip Markdown noise lines (rules, fences) so the summary is a sentence.
    .find((l) => l && !/^(?:[-*_=`#>]\s*)+$/.test(l));
  if (!line) return '';
  const plain = line.replace(/^#+\s*/, '');
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** Fields of a tool input that say what the call does, most telling first. */
const INPUT_KEYS = ['command', 'file_path', 'path', 'url', 'pattern', 'query', 'description', 'prompt'];

/** `Bash: npm install`, `Edit: src/app.ts`, or just the tool name. */
export function toolSummary(toolName: string | undefined, toolInput: unknown): string {
  if (!toolName) return '';
  const input = toolInput && typeof toolInput === 'object' ? (toolInput as Record<string, unknown>) : {};
  const key = INPUT_KEYS.find((k) => typeof input[k] === 'string' && (input[k] as string).trim());
  const what = key ? firstLine(input[key] as string, DETAIL_MAX - toolName.length - 2) : '';
  return what ? `${toolName}: ${what}` : toolName;
}

export interface NotifyInput {
  t: Translate;
  kind: SessionKind;
  status: SessionStatus;
  reason?: ErrorReason;
  /** Tool summary (waiting) or the first line of the last answer (done). */
  detail?: string;
  /** Minutes waited, for the reminder. */
  remindMinutes?: number;
}

/** `Claude · Needs input — Bash: npm install` (the title is the project name). */
export function notificationBody({ t, kind, status, reason, detail, remindMinutes }: NotifyInput): string {
  const what =
    remindMinutes !== undefined
      ? t('notify.stillWaiting', { minutes: String(remindMinutes) })
      : status === 'error'
        ? `${t('notify.error')}: ${t(`status.reason.${reason ?? 'other'}`)}`
        : t(status === 'done' ? 'notify.done' : 'notify.waiting');
  const head = `${kindLabel(t, kind)} · ${what}`;
  return detail ? `${head} — ${detail}` : head;
}

/** Statuses that ask for the user: notified, counted, and what "next waiting" cycles through. */
export const wantsAttention = (status: SessionStatus, reason?: ErrorReason): boolean =>
  status === 'waiting' || status === 'done' || (status === 'error' && reason !== 'exit');

/** Remembers the last notification per session so the same status isn't repeated within DEBOUNCE_MS. */
export class Debouncer {
  private last = new Map<string, { status: SessionStatus; at: number }>();

  /** True (and remembered) when this one should be shown. */
  allow(id: string, status: SessionStatus, now: number): boolean {
    const prev = this.last.get(id);
    if (prev && prev.status === status && now - prev.at < DEBOUNCE_MS) return false;
    this.last.set(id, { status, at: now });
    return true;
  }

  forget(id: string): void {
    this.last.delete(id);
  }
}

/** What Attention needs to know about a session when a timer fires. */
export interface AttentionSession {
  id: string;
  projectName: string;
  kind: SessionKind;
  status: SessionStatus;
  reason?: ErrorReason;
  /** When the current status started (ms). */
  since: number;
  detail?: string;
}

interface AttentionDeps {
  /** Current state of a live session; undefined once it's gone. */
  get: (id: string) => AttentionSession | undefined;
  /** Whether the user is looking at it right now (window focused and it's the focused session). */
  onScreen: (id: string) => boolean;
  t: () => Translate;
  /** Notification clicked: bring the window up and focus that session. */
  focus: (id: string) => void;
}

/** Schedules notifications for status changes (after SETTLE_MS) and one reminder per waiting stretch. */
export class Attention {
  private settle = new Map<string, NodeJS.Timeout>();
  private remind = new Map<string, NodeJS.Timeout>();
  private debounce = new Debouncer();

  constructor(private deps: AttentionDeps) {}

  /** The session's status changed (or its detail arrived). */
  changed(s: AttentionSession): void {
    clearTimeout(this.settle.get(s.id));
    this.settle.delete(s.id);
    if (wantsAttention(s.status, s.reason)) {
      const { status, since } = s;
      this.settle.set(
        s.id,
        setTimeout(() => {
          this.settle.delete(s.id);
          const now = this.deps.get(s.id);
          // Changed again meanwhile (that change scheduled its own) or the user is already on it.
          if (!now || now.status !== status || now.since !== since || this.deps.onScreen(s.id)) return;
          if (this.debounce.allow(s.id, status, Date.now())) this.show(now);
        }, SETTLE_MS),
      );
    }
    this.scheduleReminder(s);
  }

  private scheduleReminder(s: AttentionSession): void {
    const pending = this.remind.get(s.id);
    if (s.status !== 'waiting') {
      clearTimeout(pending);
      this.remind.delete(s.id);
      return;
    }
    if (pending) return; // same waiting stretch, detail update only
    const { since } = s;
    this.remind.set(
      s.id,
      setTimeout(
        () => {
          this.remind.delete(s.id);
          const now = this.deps.get(s.id);
          if (!now || now.status !== 'waiting' || now.since !== since || this.deps.onScreen(s.id)) return;
          this.show(now, Math.round((Date.now() - since) / 60_000));
        },
        Math.max(0, since + REMIND_MS - Date.now()),
      ),
    );
  }

  /** The session is gone. */
  forget(id: string): void {
    clearTimeout(this.settle.get(id));
    clearTimeout(this.remind.get(id));
    this.settle.delete(id);
    this.remind.delete(id);
    this.debounce.forget(id);
  }

  dispose(): void {
    for (const id of new Set([...this.settle.keys(), ...this.remind.keys()])) this.forget(id);
  }

  private show(s: AttentionSession, remindMinutes?: number): void {
    if (!Notification.isSupported()) return;
    const body = notificationBody({
      t: this.deps.t(),
      kind: s.kind,
      status: s.status,
      reason: s.reason,
      detail: s.detail,
      remindMinutes,
    });
    const n = new Notification({ title: s.projectName, body });
    n.on('click', () => this.deps.focus(s.id));
    n.show();
  }
}

/** Number of sessions waiting for the user on the Dock icon (macOS); empty at zero. */
export function setDockBadge(waiting: number): void {
  app.dock?.setBadge(waiting > 0 ? String(waiting) : '');
}
