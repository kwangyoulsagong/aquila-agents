import { describe, expect, it } from 'vitest';
import { OSC_7501_REPLY, OscScanner, parse7501, statusOf7501 } from './osc';

const BEL = '\x07';
const ST = '\x1b\\';

describe('OscScanner', () => {
  it('finds 7501 sequences ended by BEL or ST and skips other OSCs', () => {
    const scan = new OscScanner();
    const out = scan.feed(
      `hello\x1b]0;title${BEL}\x1b]7501;?${BEL}\x1b[c more \x1b]7501;state=idle:app=claude-code${ST}tail`,
    );
    expect(out).toEqual(['?', 'state=idle:app=claude-code']);
  });

  it('buffers a sequence split across chunks, including a split prefix and terminator', () => {
    const scan = new OscScanner();
    const seq = `\x1b]7501;state=working:app=codex${ST}`;
    for (let cut = 1; cut < seq.length; cut++) {
      expect([...scan.feed(`a${seq.slice(0, cut)}`), ...scan.feed(`${seq.slice(cut)}b`)]).toEqual([
        'state=working:app=codex',
      ]);
    }
  });

  it('drops a sequence cancelled by another ESC, and one longer than 4096 bytes', () => {
    const scan = new OscScanner();
    expect(scan.feed(`\x1b]7501;state=working\x1b[0m\x1b]7501;state=done${BEL}`)).toEqual(['state=done']);
    expect(scan.feed(`\x1b]7501;${'x'.repeat(5000)}`)).toEqual([]);
    expect(scan.feed(`${BEL}\x1b]7501;state=idle${BEL}`)).toEqual(['state=idle']);
  });

  it('is a no-op for plain output', () => {
    expect(new OscScanner().feed('just text\r\n')).toEqual([]);
  });
});

describe('parse7501', () => {
  it('treats only a bare ? as a query (never our own echoed reply)', () => {
    expect(parse7501('?')).toEqual({ type: 'query' });
    expect(parse7501(OSC_7501_REPLY.slice('\x1b]7501;'.length, -2))).toBeNull();
  });

  it('reads key=value pairs and decodes base64 title/msg', () => {
    const msg = Buffer.from('trust this folder').toString('base64');
    expect(parse7501(`state=blocked:app=claude-code:kind=permission:msg=${msg}`)).toEqual({
      type: 'report',
      fields: { state: 'blocked', app: 'claude-code', kind: 'permission', msg: 'trust this folder' },
    });
    expect(parse7501('state=working:id=bg/1:progress=40:future-key=1:junk')).toEqual({
      type: 'report',
      fields: { state: 'working', id: 'bg/1', progress: '40', 'future-key': '1' },
    });
    expect(parse7501('app=x')).toBeNull();
  });

  it('maps states and ignores unknown ones', () => {
    expect(statusOf7501('blocked')).toBe('waiting');
    expect(statusOf7501('done')).toBe('done');
    expect(statusOf7501('clear')).toBeNull();
    expect(statusOf7501('sleeping')).toBeNull();
  });
});
