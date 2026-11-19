import { describe, expect, it } from 'vitest';
import { PowerWatcher, profile, type PowerSource } from './power';
import type { PowerState, ThermalState } from '../src/shared/api/types';

function fakeSource(onBattery = false, thermal: ThermalState = 'nominal') {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const source: PowerSource = {
    isOnBatteryPower: () => onBattery,
    getCurrentThermalState: () => thermal,
    on: (event, listener) => handlers.set(event, listener),
  };
  const emit = (event: string, ...args: unknown[]) => handlers.get(event)?.(...args);
  return { source, emit };
}

describe('profile', () => {
  const base = { onBattery: false, thermal: 'nominal' as const, speedLimit: 100 };
  it('is normal on AC, cool, unthrottled', () => expect(profile(base).saver).toBe(false));
  it('saves on battery', () => expect(profile({ ...base, onBattery: true }).saver).toBe(true));
  it('saves when the CPU is throttled', () => expect(profile({ ...base, speedLimit: 70 }).saver).toBe(true));
  it('saves when serious or critical, not when fair', () => {
    expect(profile({ ...base, thermal: 'fair' }).saver).toBe(false);
    expect(profile({ ...base, thermal: 'serious' }).saver).toBe(true);
    expect(profile({ ...base, thermal: 'critical' }).saver).toBe(true);
  });
});

describe('PowerWatcher', () => {
  it('starts from the current source state', () => {
    expect(new PowerWatcher(fakeSource(true).source).current().saver).toBe(true);
    expect(new PowerWatcher(fakeSource(false).source).current().saver).toBe(false);
  });

  it('reports battery, speed-limit and thermal changes once each', () => {
    const { source, emit } = fakeSource();
    const w = new PowerWatcher(source);
    const seen: PowerState[] = [];
    w.onChange((s) => seen.push(s));

    emit('on-battery');
    emit('on-battery'); // no change → no report
    expect(seen.map((s) => s.saver)).toEqual([true]);
    emit('on-ac');
    expect(w.current().saver).toBe(false);

    emit('speed-limit-change', {}, { limit: 50 });
    expect(w.current()).toMatchObject({ speedLimit: 50, saver: true });
    emit('speed-limit-change', { limit: 100 });
    emit('thermal-state-change', { state: 'critical' });
    expect(w.current()).toMatchObject({ thermal: 'critical', saver: true });
    emit('thermal-state-change', { state: 'bogus' });
    expect(w.current()).toMatchObject({ thermal: 'unknown', saver: false });
    expect(seen).toHaveLength(6);
  });

  it('stops reporting after unsubscribe', () => {
    const { source, emit } = fakeSource();
    const w = new PowerWatcher(source);
    let n = 0;
    const off = w.onChange(() => n++);
    off();
    emit('on-battery');
    expect(n).toBe(0);
  });
});
