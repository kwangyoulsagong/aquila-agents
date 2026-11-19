// Power profile (T9): on battery, when macOS throttles the CPU, or when the Mac runs hot, Aquila does less —
// longer timers in main, no cursor blink or looping animations in the renderer. Interactive paths stay as they are.
import type { PowerState, ThermalState } from '../src/shared/api/types';

/** Activity tick (output-quiet detection) normally / in saver mode. */
export const TICK_MS = 1000;
export const SAVER_TICK_MS = 2000;

export interface PowerInput {
  onBattery: boolean;
  thermal: ThermalState;
  /** CPU speed limit in percent (100 = no limit). */
  speedLimit: number;
}

/** Saver when on battery, throttled below 100 %, or thermal state serious/critical. */
export function profile(input: PowerInput): PowerState {
  const hot = input.thermal === 'serious' || input.thermal === 'critical';
  return { ...input, saver: input.onBattery || input.speedLimit < 100 || hot };
}

/** The bits of Electron's `powerMonitor` we use (injected so tests don't need Electron). */
export interface PowerSource {
  isOnBatteryPower(): boolean;
  getCurrentThermalState?(): ThermalState;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

const THERMAL: readonly ThermalState[] = ['unknown', 'nominal', 'fair', 'serious', 'critical'];
const asThermal = (v: unknown): ThermalState =>
  THERMAL.includes(v as ThermalState) ? (v as ThermalState) : 'unknown';

/** Watches the power source and reports every change of the profile (only when something changed). */
export class PowerWatcher {
  private input: PowerInput;
  private state: PowerState;
  private listeners = new Set<(s: PowerState) => void>();

  constructor(source: PowerSource) {
    this.input = {
      onBattery: source.isOnBatteryPower(),
      thermal: asThermal(source.getCurrentThermalState?.()),
      speedLimit: 100,
    };
    this.state = profile(this.input);
    source.on('on-battery', () => this.update({ onBattery: true }));
    source.on('on-ac', () => this.update({ onBattery: false }));
    // Electron passes `{ limit }` (macOS/Windows) and `{ state }` as the event details.
    source.on('speed-limit-change', (...args) => {
      const limit = (
        args.find((a) => typeof a === 'object' && a !== null && 'limit' in a) as { limit?: unknown }
      )?.limit;
      if (typeof limit === 'number') this.update({ speedLimit: limit });
    });
    source.on('thermal-state-change', (...args) => {
      const d = args.find((a) => typeof a === 'object' && a !== null && 'state' in a) as { state?: unknown };
      this.update({ thermal: asThermal(d?.state) });
    });
  }

  current(): PowerState {
    return this.state;
  }

  onChange(cb: (s: PowerState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private update(patch: Partial<PowerInput>): void {
    this.input = { ...this.input, ...patch };
    const next = profile(this.input);
    const s = this.state;
    if (
      s.saver === next.saver &&
      s.onBattery === next.onBattery &&
      s.thermal === next.thermal &&
      s.speedLimit === next.speedLimit
    )
      return;
    this.state = next;
    for (const cb of this.listeners) cb(next);
  }
}
