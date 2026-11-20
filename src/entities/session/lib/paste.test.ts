import { describe, expect, it, vi } from 'vitest';
import { safePaste, safePasteText } from './paste';

describe('safePasteText', () => {
  it('keeps plain text, tabs and line breaks', () => {
    expect(safePasteText('echo hi\n\tls -la\r\nnext')).toBe('echo hi\n\tls -la\r\nnext');
    expect(safePasteText('한글 텍스트 · emoji 🙂')).toBe('한글 텍스트 · emoji 🙂');
  });

  it('cannot end bracketed paste early', () => {
    const attack = 'harmless\x1b[201~rm -rf ~\n';
    const out = safePasteText(attack);
    expect(out).not.toContain('\x1b');
    expect(out).toBe('harmless[201~rm -rf ~\n');
  });

  it('drops other C0 controls, DEL and C1 (8-bit CSI)', () => {
    expect(safePasteText('a\x03b\x04c\x00d\x08e\x7ff')).toBe('abcdef');
    expect(safePasteText('x\x9b201~y\x85z')).toBe('x201~yz');
    expect(safePasteText('\x0b\x0c\x1f')).toBe('');
  });
});

describe('safePaste', () => {
  it('pastes the cleaned text, and nothing when nothing is left', () => {
    const term = { paste: vi.fn() };
    safePaste(term, 'ok\x1b[201~');
    expect(term.paste).toHaveBeenCalledWith('ok[201~');
    safePaste(term, '\x1b');
    expect(term.paste).toHaveBeenCalledTimes(1);
  });
});
