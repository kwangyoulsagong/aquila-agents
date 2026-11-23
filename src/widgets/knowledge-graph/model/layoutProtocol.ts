/** Panel → layout worker. */
export type LayoutRequest =
  | {
      type: 'start';
      xy: Float32Array;
      edges: Uint32Array;
      weights: Float32Array;
      /** Send positions every ~100 ms while it runs (off in power saver: only the final picture). */
      animate: boolean;
      /** Give up after this long even if not settled (≤ 3 s). */
      maxMs: number;
    }
  | { type: 'stop' };

/** Layout worker → panel. `done` is the last message of a run. */
export interface LayoutReply {
  type: 'tick' | 'done';
  xy: Float32Array;
  iterations: number;
  ms: number;
}
