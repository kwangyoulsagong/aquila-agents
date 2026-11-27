import { describe, expect, it } from 'vitest';
import { linkFirstMention, linkName } from './splice';

describe('linkFirstMention', () => {
  it('links the first plain mention only, exact output', () => {
    const s = linkFirstMention('See Login flow here. Login flow again.', 'Login flow', 'Login flow');
    expect(s?.text).toBe('See [[Login flow]] here. Login flow again.');
    expect(s).toMatchObject({ from: 4, to: 14, insert: '[[Login flow]]' });
  });

  it('keeps the words as written: alias when the file name differs, same case otherwise', () => {
    expect(linkFirstMention('about login flow.', 'Login flow', 'FE-REQ-030-login')?.text).toBe(
      'about [[FE-REQ-030-login|login flow]].',
    );
    expect(linkFirstMention('about login flow.', 'Login flow', 'Login flow')?.text).toBe(
      'about [[login flow]].',
    );
  });

  it('keeps CRLF and every other byte', () => {
    const src = '---\r\ntitle: Login flow\r\n---\r\n# Notes\r\n\r\nThe Login flow works.\r\nend\r\n';
    expect(linkFirstMention(src, 'Login flow', 'Login flow')?.text).toBe(
      '---\r\ntitle: Login flow\r\n---\r\n# Notes\r\n\r\nThe [[Login flow]] works.\r\nend\r\n',
    );
  });

  it('skips frontmatter, fenced code, inline code, existing links and URLs', () => {
    const src = [
      '```',
      'Login flow',
      '```',
      '~~~md',
      'Login flow',
      '~~~',
      '`Login flow` and [[Login flow]] and [Login flow](x.md) and https://a.com/Login flow',
      'finally Login flow',
    ].join('\n');
    expect(linkFirstMention(src, 'Login flow', 'Login flow')?.text.split('\n').pop()).toBe(
      'finally [[Login flow]]',
    );
  });

  it('ASCII titles as whole words; non-ASCII titles inside words (Korean particles)', () => {
    expect(linkFirstMention('Loginflow, Login flows', 'Login flow', 'x')).toBeNull();
    expect(linkFirstMention('로그인 흐름을 고쳤다', '로그인 흐름', '로그인 흐름')?.text).toBe(
      '[[로그인 흐름]]을 고쳤다',
    );
  });

  it('null when there is nothing to link', () => {
    expect(linkFirstMention('nothing here', 'Login flow', 'x')).toBeNull();
    expect(linkFirstMention('Login flow', '  ', 'x')).toBeNull();
  });
});

describe('linkName', () => {
  it('is the file name without .md', () => {
    expect(linkName('/v/specs/FE-REQ-030 login.md')).toBe('FE-REQ-030 login');
  });
});
