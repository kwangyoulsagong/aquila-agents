import { describe, expect, it } from 'vitest';
import { nextOrder, panelsThatFit, panelsToClose } from './panels';

describe('side panel fit', () => {
  it('fits two panels in a 1440 px window and three in a 1728 px one', () => {
    expect(panelsThatFit(1440, 248, 480, 288)).toBe(2);
    expect(panelsThatFit(1728, 248, 480, 288)).toBe(3);
  });

  it('always lets one panel open, however narrow the window', () => {
    expect(panelsThatFit(800, 248, 480, 288)).toBe(1);
  });

  it('keeps the open order oldest first, dropping closed panels', () => {
    expect(nextOrder([], ['changes'])).toEqual(['changes']);
    expect(nextOrder(['changes'], ['changes', 'run'])).toEqual(['changes', 'run']);
    expect(nextOrder(['changes', 'run'], ['changes', 'run', 'preview'])).toEqual([
      'changes',
      'run',
      'preview',
    ]);
    expect(nextOrder(['changes', 'run', 'preview'], ['run', 'preview'])).toEqual(['run', 'preview']);
    expect(nextOrder(['run', 'preview'], ['changes', 'run', 'preview'])).toEqual([
      'run',
      'preview',
      'changes',
    ]);
  });

  it('closes the oldest panels so the newest fits', () => {
    expect(panelsToClose(['changes', 'run', 'preview'], 2)).toEqual(['changes']);
    expect(panelsToClose(['changes', 'run', 'preview'], 1)).toEqual(['changes', 'run']);
    expect(panelsToClose(['changes', 'run'], 2)).toEqual([]);
    expect(panelsToClose(['run', 'preview'], 0)).toEqual(['run']);
  });
});
