import { describe, expect, it } from 'vitest';
import { problemOf } from './useSources';

describe('problemOf', () => {
  it('reads the code out of an IPC error', () => {
    expect(problemOf(new Error("Error invoking remote method 'graph:add-source': Error: overlap"))).toBe('overlap');
    expect(problemOf(new Error('Error: notFolder'))).toBe('notFolder');
    expect(problemOf('boom')).toBe('other');
  });
});
