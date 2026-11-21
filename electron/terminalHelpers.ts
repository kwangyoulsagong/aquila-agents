// Terminal helpers (T28), main-process side: clipboard files/images → paths, and the last agent reply of a tab.
// Transcripts are read-only (the tail of `~/.claude*/projects/…/<id>.jsonl` or `~/.codex/sessions/…/rollout-…-<id>.jsonl`).
// Pasted images go to a temp folder of ours and are pruned after a day.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PASTE_DIR = path.join(os.tmpdir(), 'aquila-paste');
/** Pasted images older than this are deleted on the next paste. */
export const PASTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Bytes read from the end of a transcript; a reply longer than this comes back cut at the front. */
export const TAIL_BYTES = 4 * 1024 * 1024;

type Block = { type?: unknown; text?: unknown };

function textOf(content: unknown, type: string): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Block[])
    .filter((b) => b && b.type === type && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

const parse = (line: string): Record<string, unknown> | null => {
  try {
    const o: unknown = JSON.parse(line);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  } catch {
    return null; // cut first line of the tail, or a line being written
  }
};

/**
 * The text of the last assistant message in a transcript (or its tail). Claude stores one API message as several
 * lines (one per content block, same `message.id`): their text parts are joined. Tool calls and thinking are left out.
 */
export function lastReply(text: string, agent: 'claude' | 'codex'): string | null {
  const lines = text.split('\n');
  const parts: string[] = [];
  let msgId: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const o = parse(line);
    if (!o) continue;
    if (agent === 'codex') {
      const p = o.payload as Record<string, unknown> | undefined;
      if (o.type !== 'response_item' || !p || p.type !== 'message' || p.role !== 'assistant') continue;
      const t = textOf(p.content, 'output_text').trim();
      if (t) return t;
      continue;
    }
    if (o.isSidechain === true) continue;
    const message = o.message as { id?: unknown; content?: unknown } | undefined;
    const id = typeof message?.id === 'string' ? message.id : undefined;
    if (msgId !== undefined) {
      // Collecting one message: earlier blocks of it come first in the file.
      if (o.type !== 'assistant' || id !== msgId) break;
      const t = textOf(message?.content, 'text').trim();
      if (t) parts.unshift(t);
      continue;
    }
    if (o.type !== 'assistant' || !message) continue;
    const t = textOf(message.content, 'text').trim();
    if (!t) continue;
    parts.unshift(t);
    if (!id) break;
    msgId = id;
  }
  return parts.length ? parts.join('\n\n') : null;
}

/** The last `bytes` of a file as text ('' when it can't be read). */
export function readTail(file: string, bytes = TAIL_BYTES): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** `<configDir>/projects/*\/<id>.jsonl`, looked up in every project dir (same as `hasClaudeTranscript`). */
export function findClaudeTranscript(configDir: string, sessionId: string): string | null {
  const root = path.join(configDir, 'projects');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const file = path.join(root, d, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** The rollout file of a codex session id, newest day folder first. */
export function findRollout(root: string, sessionId: string): string | null {
  const id = sessionId.toLowerCase();
  const dirs = (d: string) => {
    try {
      return fs
        .readdirSync(d)
        .filter((x) => /^\d+$/.test(x))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  };
  for (const y of dirs(root))
    for (const m of dirs(path.join(root, y)))
      for (const d of dirs(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        try {
          const f = fs
            .readdirSync(dir)
            .find((x) => x.startsWith('rollout-') && x.toLowerCase().endsWith(`${id}.jsonl`));
          if (f) return path.join(dir, f);
        } catch {
          // gone
        }
      }
  return null;
}

// ── Clipboard ──────────────────────────────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Paths in a macOS `NSFilenamesPboardType` property list (Finder ⌘C on one or more files). */
export function parseFilenamesPlist(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<string>([^<]*)<\/string>/g)) {
    const p = m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_s, e: string) => XML_ENTITIES[e]);
    if (p.startsWith('/')) out.push(p);
  }
  return out;
}

/** `file:///Users/me/a%20b.png` → `/Users/me/a b.png`; null for anything else. */
export function pathFromFileUrl(url: string): string | null {
  if (!url.startsWith('file://')) return null;
  try {
    return decodeURIComponent(new URL(url).pathname) || null;
  } catch {
    return null;
  }
}

/** Electron's raw clipboard format name for a macOS pasteboard type. */
export const rawFormat = (type: string) => `electron application/osclipboard;format="${type}"`;

/**
 * The clipboard as a set of types (MIME or `rawFormat(...)`) and their bytes — Electron 45's async clipboard, behind
 * an interface so the logic can be tested without Electron.
 */
export interface ClipboardLike {
  types: readonly string[];
  get(type: string): Promise<Buffer>;
}

/** Deletes pasted images older than `maxAge`. */
export function prunePasteDir(dir = PASTE_DIR, maxAge = PASTE_MAX_AGE_MS, now = Date.now()): void {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      if (now - fs.statSync(file).mtimeMs > maxAge) fs.unlinkSync(file);
    } catch {
      // gone or busy
    }
  }
}

const stamp = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-` +
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

/**
 * Files on the clipboard as paths: copied files (Finder) as they are, an image (screenshot) saved as a PNG in
 * PASTE_DIR. Empty when the clipboard holds neither.
 */
export async function clipboardPaths(
  cb: ClipboardLike,
  dir = PASTE_DIR,
  now = new Date(),
): Promise<string[]> {
  const read = async (type: string) => (cb.types.includes(type) ? (await cb.get(type)).toString('utf8') : '');
  const files = parseFilenamesPlist(await read(rawFormat('NSFilenamesPboardType')));
  if (files.length) return files;
  const one = pathFromFileUrl(await read(rawFormat('public.file-url')));
  if (one) return [one];
  const pngType = cb.types.includes('image/png') ? 'image/png' : rawFormat('public.png');
  if (!cb.types.includes(pngType)) return [];
  const png = await cb.get(pngType);
  if (!png.length) return [];
  prunePasteDir(dir, PASTE_MAX_AGE_MS, now.getTime());
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `paste-${stamp(now)}.png`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `paste-${stamp(now)}-${i}.png`);
  fs.writeFileSync(file, png);
  return [file];
}
