import { describe, expect, it, vi } from 'vitest';
import { GpuPool } from './gpuPool';

const member = () => ({ setGpu: vi.fn() });

describe('GpuPool', () => {
  it('keeps WebGL on hidden terminals while under the cap', () => {
    const pool = new GpuPool(2);
    const a = member();
    pool.show(a, true);
    pool.show(a, false);
    expect(a.setGpu).toHaveBeenCalledWith(true);
    expect(a.setGpu).not.toHaveBeenCalledWith(false);
  });

  it('drops the least recently seen hidden terminal over the cap', () => {
    const pool = new GpuPool(2);
    const [a, b, c] = [member(), member(), member()];
    for (const m of [a, b, c]) {
      pool.show(m, true);
      pool.show(m, false);
    }
    expect(a.setGpu).toHaveBeenLastCalledWith(false);
    expect(b.setGpu).toHaveBeenLastCalledWith(true);
    expect(c.setGpu).toHaveBeenLastCalledWith(true);
  });

  it('never drops a terminal on screen', () => {
    const pool = new GpuPool(1);
    const [a, b] = [member(), member()];
    pool.show(a, true);
    pool.show(b, true);
    expect(a.setGpu).not.toHaveBeenCalledWith(false);
    expect(b.setGpu).not.toHaveBeenCalledWith(false);
  });

  it('seeing a terminal again makes it the most recent', () => {
    const pool = new GpuPool(2);
    const [a, b, c] = [member(), member(), member()];
    pool.show(a, true);
    pool.show(a, false);
    pool.show(b, true);
    pool.show(b, false);
    pool.show(a, true);
    pool.show(a, false);
    pool.show(c, true);
    expect(b.setGpu).toHaveBeenLastCalledWith(false);
    expect(a.setGpu).not.toHaveBeenCalledWith(false);
  });

  it('forgets removed members', () => {
    const pool = new GpuPool(1);
    const [a, b] = [member(), member()];
    pool.show(a, true);
    pool.remove(a);
    pool.show(b, true);
    expect(a.setGpu).not.toHaveBeenCalledWith(false);
  });
});
