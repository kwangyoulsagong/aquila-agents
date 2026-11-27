import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { readOnly, readOnlyCompartment } from './editor';
import { isReading, reading, readingCompartment } from './readingMode';

describe('reading mode', () => {
  it('makes the state read-only though the read-only compartment (readOnly: false) comes first', () => {
    const state = (on: boolean) =>
      EditorState.create({
        doc: '# Title',
        extensions: [readOnlyCompartment.of(readOnly(false)), readingCompartment.of(reading(on))],
      });
    expect(state(true).readOnly).toBe(true);
    expect(isReading(state(true))).toBe(true);
    expect(state(false).readOnly).toBe(false);
  });
});
