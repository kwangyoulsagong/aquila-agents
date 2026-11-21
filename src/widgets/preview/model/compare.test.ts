import { describe, expect, it } from 'vitest';
import { buildComparePrompt, toLayout, toOpacity } from './compare';

describe('toLayout', () => {
  it('keeps known layouts and falls back to stacked', () => {
    expect(toLayout('side')).toBe('side');
    expect(toLayout('overlay')).toBe('overlay');
    expect(toLayout('')).toBe('stacked');
    expect(toLayout('grid')).toBe('stacked');
  });
});

describe('toOpacity', () => {
  it('clamps and rounds, 50 by default', () => {
    expect(toOpacity('')).toBe(50);
    expect(toOpacity('abc')).toBe(50);
    expect(toOpacity('30')).toBe(30);
    expect(toOpacity('140')).toBe(100);
    expect(toOpacity('-5')).toBe(0);
    expect(toOpacity('33.6')).toBe(34);
  });
});

describe('buildComparePrompt', () => {
  it('names both images in paste order, then the ask', () => {
    const text = buildComparePrompt(
      { page: 'http://localhost:5173/cart', design: 'https://www.figma.com/design/abc/Cart?node-id=1-2' },
      { intro: 'Compare these two screenshots:', app: 'App', design: 'Figma design', ask: 'Fix the differences.' },
    );
    expect(text).toBe(
      [
        'Compare these two screenshots:',
        '1. App: http://localhost:5173/cart',
        '2. Figma design: https://www.figma.com/design/abc/Cart?node-id=1-2',
        'Fix the differences.',
      ].join('\n'),
    );
  });
});
