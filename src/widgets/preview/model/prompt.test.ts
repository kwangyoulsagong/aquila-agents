import { describe, expect, it } from 'vitest';
import type { PickResult } from '@/shared/api';
import { buildPickPrompt, type PickLabels } from './prompt';

const labels: PickLabels = {
  intro: 'Change this:',
  page: 'Page',
  element: 'Element',
  component: 'Component',
  text: 'Text',
  attrs: 'Attributes',
  size: 'Size',
  styles: 'Style',
  screenshot: 'Screenshot follows.',
};

const pick: PickResult = {
  url: 'http://localhost:5173/settings',
  selector: 'form > button.save',
  tag: 'button',
  text: 'Save',
  attrs: { type: 'submit' },
  components: ['SaveButton', 'SettingsForm'],
  source: 'src/Save.tsx:12',
  styles: { color: 'rgb(255, 255, 255)', 'font-size': '14px' },
  rect: { x: 10, y: 20, width: 96.4, height: 32 },
  imagePath: '/tmp/pick.png',
};

describe('buildPickPrompt', () => {
  it('lists everything that was found', () => {
    expect(buildPickPrompt(pick, labels)).toBe(
      [
        'Change this:',
        'Page: http://localhost:5173/settings',
        'Element: `form > button.save`',
        'Component: SaveButton ← SettingsForm (src/Save.tsx:12)',
        'Text: "Save"',
        'Attributes: type="submit"',
        'Size: 96×32',
        'Style: color: rgb(255, 255, 255); font-size: 14px',
        'Screenshot follows.',
      ].join('\n'),
    );
  });

  it('leaves out what is missing', () => {
    const bare = {
      ...pick,
      text: '',
      attrs: {},
      components: [],
      source: undefined,
      styles: {},
      imagePath: undefined,
    };
    expect(buildPickPrompt(bare, labels)).toBe(
      [
        'Change this:',
        'Page: http://localhost:5173/settings',
        'Element: `form > button.save`',
        'Size: 96×32',
      ].join('\n'),
    );
  });
});
