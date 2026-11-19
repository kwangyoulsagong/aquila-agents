// Decides which terminals keep a WebGL renderer. Chromium allows only ~16 live WebGL contexts per page and drops the
// oldest beyond that (possibly one on screen), while the DOM renderer that replaces WebGL costs more memory per
// terminal. So: terminals on screen always get WebGL, the most recently seen hidden ones keep it, up to MAX_GPU.
// Measured with 15 shells (`npm run perf`): dropping WebGL from every hidden terminal cost ~+125 MB renderer memory.

export const MAX_GPU = 12;

export interface GpuMember {
  setGpu: (on: boolean) => void;
}

export class GpuPool<T extends GpuMember> {
  /** Members with WebGL, least recently seen first. */
  private order: T[] = [];
  private visible = new Set<T>();

  constructor(private max = MAX_GPU) {}

  /** A member came on / went off screen. */
  show(m: T, visible: boolean): void {
    if (!visible) {
      this.visible.delete(m);
      return;
    }
    this.visible.add(m);
    this.order = this.order.filter((x) => x !== m);
    this.order.push(m);
    m.setGpu(true);
    this.evict();
  }

  /** The member's WebGL is gone (context lost or unmounted). */
  remove(m: T): void {
    this.visible.delete(m);
    this.order = this.order.filter((x) => x !== m);
  }

  private evict(): void {
    while (this.order.length > this.max) {
      const victim = this.order.find((x) => !this.visible.has(x));
      if (!victim) return; // everything with WebGL is on screen
      this.remove(victim);
      victim.setGpu(false);
    }
  }
}

export const gpuPool = new GpuPool<GpuMember>();
