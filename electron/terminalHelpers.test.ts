import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clipboardPaths,
  findClaudeTranscript,
  findRollout,
  lastReply,
  parseFilenamesPlist,
  pathFromFileUrl,
  prunePasteDir,
  rawFormat,
  readTail,
  type ClipboardLike,
} from './terminalHelpers';

const tmp: string[] = [];
const mkTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-th-'));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const j = (o: unknown) => JSON.stringify(o);

describe('lastReply (claude)', () => {
  it('joins the text blocks of the last assistant message and skips tool calls', () => {
    const lines = [
      j({ type: 'user', message: { content: 'fix it' } }),
      j({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Looking.' }] } }),
      j({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'Bash' }] } }),
      j({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      j({ type: 'assistant', message: { id: 'm2', content: [{ type: 'thinking', thinking: 'hm' }] } }),
      j({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } }),
      j({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Tests pass.' }] } }),
      j({ type: 'system', subtype: 'turn_duration' }),
      '',
    ];
    expect(lastReply(lines.join('\n'), 'claude')).toBe('Done.\n\nTests pass.');
  });

  it('ignores sidechains, a cut first line and a half-written last line', () => {
    const text = [
      'ext":"cut"}]}}',
      j({ type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'Main answer' }] } }),
      j({
        type: 'assistant',
        isSidechain: true,
        message: { id: 'b', content: [{ type: 'text', text: 'sub' }] },
      }),
      '{"type":"assistant","mess',
    ].join('\n');
    expect(lastReply(text, 'claude')).toBe('Main answer');
  });

  it('is null without a reply', () => {
    expect(lastReply(j({ type: 'user', message: { content: 'hi' } }), 'claude')).toBeNull();
    expect(lastReply('', 'claude')).toBeNull();
  });
});

describe('lastReply (codex)', () => {
  it('takes the last assistant message with output text', () => {
    const msg = (role: string, type: string, text: string) =>
      j({ type: 'response_item', payload: { type: 'message', role, content: [{ type, text }] } });
    const text = [
      j({ type: 'session_meta', payload: { id: 'x' } }),
      msg('user', 'input_text', 'q'),
      msg('assistant', 'output_text', 'first'),
      msg('assistant', 'output_text', 'second'),
      j({ type: 'response_item', payload: { type: 'function_call' } }),
    ].join('\n');
    expect(lastReply(text, 'codex')).toBe('second');
  });
});

describe('transcript lookup', () => {
  it('finds a claude transcript in any project dir and reads its tail', () => {
    const dir = mkTmp();
    fs.mkdirSync(path.join(dir, 'projects', '-a'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'projects', '-b'), { recursive: true });
    const file = path.join(dir, 'projects', '-b', 'abc.jsonl');
    fs.writeFileSync(file, '0123456789');
    expect(findClaudeTranscript(dir, 'abc')).toBe(file);
    expect(findClaudeTranscript(dir, 'nope')).toBeNull();
    expect(readTail(file, 4)).toBe('6789');
    expect(readTail(path.join(dir, 'missing'))).toBe('');
  });

  it('finds a codex rollout by id', () => {
    const root = mkTmp();
    const id = '0199a000-0000-7000-8000-00000000abcd';
    const day = path.join(root, '2026', '11', '19');
    fs.mkdirSync(day, { recursive: true });
    const file = path.join(day, `rollout-2026-11-19T10-00-00-${id}.jsonl`);
    fs.writeFileSync(file, '');
    expect(findRollout(root, id.toUpperCase())).toBe(file);
    expect(findRollout(root, '0199a000-0000-7000-8000-000000000000')).toBeNull();
  });
});

describe('clipboard', () => {
  it('parses Finder file lists and file URLs', () => {
    const xml =
      '<?xml version="1.0"?><plist><array><string>/Users/me/a &amp; b.png</string>' +
      '<string>/tmp/c.txt</string></array></plist>';
    expect(parseFilenamesPlist(xml)).toEqual(['/Users/me/a & b.png', '/tmp/c.txt']);
    expect(pathFromFileUrl('file:///Users/me/a%20b.png')).toBe('/Users/me/a b.png');
    expect(pathFromFileUrl('https://x')).toBeNull();
  });

  const board = (data: Record<string, string | Buffer>): ClipboardLike => ({
    types: Object.keys(data),
    get: async (t) => Buffer.from(data[t]),
  });

  it('prefers copied files over the image', async () => {
    const paths = await clipboardPaths(
      board({
        [rawFormat('NSFilenamesPboardType')]: '<plist><array><string>/x/y.png</string></array></plist>',
        'image/png': Buffer.from([1, 2, 3]),
      }),
      mkTmp(),
    );
    expect(paths).toEqual(['/x/y.png']);
  });

  it('saves an image as a PNG in the paste dir', async () => {
    const dir = mkTmp();
    const now = new Date(2026, 10, 19, 9, 5, 7);
    const a = await clipboardPaths(board({ 'image/png': Buffer.from([1, 2, 3]) }), dir, now);
    const b = await clipboardPaths(board({ 'image/png': Buffer.from([4]) }), dir, now);
    expect(a).toEqual([path.join(dir, 'paste-20261119-090507.png')]);
    expect(b).toEqual([path.join(dir, 'paste-20261119-090507-2.png')]);
    expect([...fs.readFileSync(a[0])]).toEqual([1, 2, 3]);
  });

  it('is empty for text', async () => {
    expect(await clipboardPaths(board({ 'text/plain': 'hi' }), mkTmp())).toEqual([]);
  });

  it('prunes old pasted images', () => {
    const dir = mkTmp();
    const old = path.join(dir, 'old.png');
    const fresh = path.join(dir, 'fresh.png');
    fs.writeFileSync(old, '');
    fs.writeFileSync(fresh, '');
    const now = Date.now();
    fs.utimesSync(old, new Date(now - 2 * 86_400_000), new Date(now - 2 * 86_400_000));
    prunePasteDir(dir, 86_400_000, now);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
