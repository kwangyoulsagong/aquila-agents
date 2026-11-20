import { describe, expect, it } from 'vitest';
import { renameValue } from './rename';

describe('renameValue', () => {
  it('sends a new title', () => {
    expect(renameValue('  Fix   login ', { shown: 'Claude' })).toBe('Fix login');
  });
  it('does not pin the automatic title when Enter is pressed unchanged', () => {
    expect(renameValue('Fix the login bug', { shown: 'Fix the login bug' })).toBeNull();
    expect(renameValue('', { shown: 'Claude' })).toBeNull();
  });
  it('clears a user title when emptied', () => {
    expect(renameValue('   ', { title: 'Mine', shown: 'Mine' })).toBe('');
  });
  it('ignores an unchanged user title', () => {
    expect(renameValue('Mine', { title: 'Mine', shown: 'Mine' })).toBeNull();
  });
});
