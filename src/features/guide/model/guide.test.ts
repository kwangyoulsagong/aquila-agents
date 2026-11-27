import { describe, expect, it } from 'vitest';
import { translator } from '@/shared/i18n';
import { SHORTCUT_IDS } from '@/shared/lib/shortcuts';
import { guideMedia, mediaFrom } from './media';
import { GUIDE_ITEMS, SHORTCUTS_ITEM } from './registry';
import { guideEntries, searchGuide } from './search';
import { SHEET, buildSheet, expandIds, shortcutKeys } from './sheet';

const en = translator('en');
const ko = translator('ko');

describe('shortcut sheet', () => {
  it('lists every shortcut of the map exactly once', () => {
    const listed = SHEET.flatMap((g) => g.rows.flatMap((r) => expandIds(r.ids)));
    expect([...listed].sort()).toEqual([...SHORTCUT_IDS].sort());
  });

  it('shows a project range as one key', () => {
    expect(shortcutKeys(['project1', 'project9'], 'mac')).toEqual(['⌘1–⌘9']);
    expect(shortcutKeys(['openClaude', 'openCodex'], 'mac')).toEqual(['⌘T', '⇧⌘T']);
    expect(shortcutKeys(['guide'], 'other')).toEqual(['Ctrl+/']);
  });

  it("shows the note editor's own keys", () => {
    const notes = buildSheet(en, 'mac').find((g) => g.title === en('guide.group.notes'));
    expect(notes?.rows.map((r) => r.keys)).toEqual([['⌥⇧↑', '⌥⇧↓'], ['/'], ['⌘E']]);
    const other = buildSheet(en, 'other').find((g) => g.title === en('guide.group.notes'));
    expect(other?.rows[2]?.keys).toEqual(['Ctrl+E']);
  });

  it('builds labels in both languages', () => {
    for (const t of [en, ko])
      for (const g of buildSheet(t)) {
        expect(g.title).not.toBe('');
        for (const r of g.rows) expect(r.label).not.toBe('');
      }
  });
});

describe('registry', () => {
  it('has unique ids, text in both languages and only known shortcuts', () => {
    expect(new Set(GUIDE_ITEMS.map((i) => i.id)).size).toBe(GUIDE_ITEMS.length);
    for (const t of [en, ko])
      for (const e of guideEntries(GUIDE_ITEMS, t)) {
        expect(e.title).not.toBe('');
        expect(e.body).not.toMatch(/\{\w+\}/); // every placeholder filled
      }
    for (const i of GUIDE_ITEMS) for (const s of i.shortcuts ?? []) expect(SHORTCUT_IDS).toContain(s);
  });

  it('mentions every shortcut on some item, so none is undiscoverable', () => {
    const shown = new Set(GUIDE_ITEMS.flatMap((i) => expandIds(i.shortcuts ?? [])));
    // The palette and the guide itself are on items too; only check nothing is missing.
    expect(SHORTCUT_IDS.filter((id) => !shown.has(id))).toEqual([]);
  });
});

describe('searchGuide', () => {
  const entries = guideEntries(GUIDE_ITEMS, en);
  const ids = (q: string, list = entries, t = en) => searchGuide(list, q, t).map((e) => e.item.id);

  it('keeps the registry order for an empty query', () => {
    expect(ids('  ')).toEqual(GUIDE_ITEMS.map((i) => i.id));
  });

  it('ranks title matches above body matches', () => {
    const r = ids('zoom');
    expect(r[0]).toBe('zoom');
    // The shortcut sheet lists "Zoom / restore pane" too.
    expect(r).toContain(SHORTCUTS_ITEM);
  });

  it('matches the body as typed, not scattered letters', () => {
    expect(ids('dock badge')).toEqual(['notify']);
    expect(ids('xqz')).toEqual([]);
  });

  it('searches Korean text', () => {
    const koEntries = guideEntries(GUIDE_ITEMS, ko);
    expect(ids('워크트리', koEntries, ko)[0]).toBe('worktree');
  });
});

describe('guide media', () => {
  it('prefers the loop with its poster, else the still', () => {
    const files = {
      '../media/a.en.webm': 'a.webm',
      '../media/a.en.webp': 'a.webp',
      '../media/b.ko.webp': 'b.webp',
    };
    expect(mediaFrom(files, 'a', 'en')).toEqual({ src: 'a.webm', kind: 'video', poster: 'a.webp' });
    expect(mediaFrom(files, 'b', 'ko')).toEqual({ src: 'b.webp', kind: 'image' });
    expect(mediaFrom(files, 'b', 'en')).toBeUndefined();
  });

  it('every feature has captured media in ko and en (run `npm run capture`)', () => {
    const missing = GUIDE_ITEMS.filter((i) => i.id !== SHORTCUTS_ITEM).flatMap((i) =>
      (['ko', 'en'] as const).filter((lang) => !guideMedia(i.id, lang)).map((lang) => `${i.id}.${lang}`),
    );
    expect(missing).toEqual([]);
  });
});
