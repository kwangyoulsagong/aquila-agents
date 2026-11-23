import { describe, expect, it } from 'vitest';
import { imageSrc } from './images';

const note = '/Users/me/notes/meetings/sync.md';
const local = (abs: string) => `aquila-note://local/${encodeURIComponent(abs)}`;

describe('imageSrc', () => {
  it('resolves relative paths next to the note', () => {
    expect(imageSrc(note, 'attachments/a.png')).toBe(local('/Users/me/notes/meetings/attachments/a.png'));
    expect(imageSrc(note, '<../img/b c.png>')).toBe(local('/Users/me/notes/img/b c.png'));
    expect(imageSrc(note, './x%20y.png?v=1')).toBe(local('/Users/me/notes/meetings/x y.png'));
  });
  it('keeps data images, drops remote ones', () => {
    expect(imageSrc(note, 'data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
    expect(imageSrc(note, 'https://example.com/a.png')).toBeNull();
    expect(imageSrc(note, '//cdn/a.png')).toBeNull();
  });
});
