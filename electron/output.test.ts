import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HIDDEN_INTERVAL_MS,
  HIGH_WATER,
  LOW_WATER,
  MAX_BATCH_BYTES,
  OutputBatcher,
  VISIBLE_INTERVAL_MS,
} from './output';

function setup(visible = true) {
  const sent: string[] = [];
  const sink = { send: (d: string) => sent.push(d), pause: vi.fn(), resume: vi.fn() };
  const b = new OutputBatcher(sink);
  b.setVisible(visible);
  return { b, sent, sink };
}

describe('OutputBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('joins chunks into one message per frame while visible', () => {
    const { b, sent } = setup();
    b.push('a');
    b.push('b');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(VISIBLE_INTERVAL_MS);
    expect(sent).toEqual(['ab']);
  });

  it('waits longer while hidden, and flushes when it comes on screen', () => {
    const { b, sent } = setup(false);
    b.push('x');
    vi.advanceTimersByTime(VISIBLE_INTERVAL_MS * 2);
    expect(sent).toEqual([]);
    b.setVisible(true);
    expect(sent).toEqual(['x']);

    b.setVisible(false);
    b.push('y');
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS);
    expect(sent).toEqual(['x', 'y']);
  });

  it('flushes at once when the buffer is full', () => {
    const { b, sent } = setup();
    b.push('z'.repeat(MAX_BATCH_BYTES));
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(VISIBLE_INTERVAL_MS);
    expect(sent).toHaveLength(1);
  });

  it('pauses the pty at the high water mark and resumes at the low one', () => {
    const { b, sink } = setup();
    for (let i = 0; i < HIGH_WATER; i++) {
      b.push(String(i));
      b.flush();
    }
    expect(sink.pause).toHaveBeenCalledTimes(1);
    for (let i = HIGH_WATER; i > LOW_WATER + 1; i--) b.ack();
    expect(sink.resume).not.toHaveBeenCalled();
    b.ack();
    expect(sink.resume).toHaveBeenCalledTimes(1);
    b.ack();
    expect(sink.resume).toHaveBeenCalledTimes(1);
  });

  it('resumes after a renderer reload drops the acks', () => {
    const { b, sink } = setup();
    for (let i = 0; i < HIGH_WATER; i++) {
      b.push('.');
      b.flush();
    }
    b.resetFlow();
    expect(sink.resume).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an empty flush and drops the buffer on dispose', () => {
    const { b, sent } = setup();
    b.flush();
    b.push('gone');
    b.dispose();
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS);
    expect(sent).toEqual([]);
  });
});
