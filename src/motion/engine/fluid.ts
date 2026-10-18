/**
 * Stable fluids (Jos Stam, "Real-Time Fluid Dynamics for Games", 2003) on a small rectangular grid: velocity is
 * advected through itself and projected to stay free of divergence, and dye is carried along by it. Unconditionally
 * stable, so it can step at any frame rate. Two dye channels let two colours mix in the flow.
 */
export class FluidGrid {
  readonly nx: number;
  readonly ny: number;
  private size: number;
  u: Float32Array;
  v: Float32Array;
  private u0: Float32Array;
  private v0: Float32Array;
  dyeA: Float32Array;
  dyeB: Float32Array;
  private scratch: Float32Array;
  private p: Float32Array;
  private div: Float32Array;

  constructor(nx: number, ny: number) {
    this.nx = nx;
    this.ny = ny;
    this.size = (nx + 2) * (ny + 2);
    const field = () => new Float32Array(this.size);
    this.u = field();
    this.v = field();
    this.u0 = field();
    this.v0 = field();
    this.dyeA = field();
    this.dyeB = field();
    this.scratch = field();
    this.p = field();
    this.div = field();
  }

  index(x: number, y: number): number {
    return x + (this.nx + 2) * y;
  }

  /** Adds velocity and dye around cell (x, y) in a soft disc of `radius` cells. */
  splat(x: number, y: number, du: number, dv: number, a: number, b: number, radius: number): void {
    const r2 = radius * radius;
    for (let j = Math.max(1, Math.floor(y - radius)); j <= Math.min(this.ny, Math.ceil(y + radius)); j++) {
      for (let i = Math.max(1, Math.floor(x - radius)); i <= Math.min(this.nx, Math.ceil(x + radius)); i++) {
        const d2 = (i - x) * (i - x) + (j - y) * (j - y);
        if (d2 > r2) continue;
        const w = Math.exp(-d2 / (r2 * 0.4));
        const k = this.index(i, j);
        this.u[k] += du * w;
        this.v[k] += dv * w;
        this.dyeA[k] = Math.min(4, this.dyeA[k]! + a * w);
        this.dyeB[k] = Math.min(4, this.dyeB[k]! + b * w);
      }
    }
  }

  private bounds(mode: 0 | 1 | 2, f: Float32Array): void {
    const { nx, ny } = this;
    for (let i = 1; i <= nx; i++) {
      f[this.index(i, 0)] = mode === 2 ? -f[this.index(i, 1)]! : f[this.index(i, 1)]!;
      f[this.index(i, ny + 1)] = mode === 2 ? -f[this.index(i, ny)]! : f[this.index(i, ny)]!;
    }
    for (let j = 1; j <= ny; j++) {
      f[this.index(0, j)] = mode === 1 ? -f[this.index(1, j)]! : f[this.index(1, j)]!;
      f[this.index(nx + 1, j)] = mode === 1 ? -f[this.index(nx, j)]! : f[this.index(nx, j)]!;
    }
  }

  private advect(mode: 0 | 1 | 2, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array, dt: number): void {
    const { nx, ny } = this;
    const scale = dt * Math.max(nx, ny);
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = this.index(i, j);
        let x = i - scale * u[k]!;
        let y = j - scale * v[k]!;
        x = Math.min(nx + 0.5, Math.max(0.5, x));
        y = Math.min(ny + 0.5, Math.max(0.5, y));
        const i0 = Math.floor(x);
        const j0 = Math.floor(y);
        const s1 = x - i0;
        const t1 = y - j0;
        d[k] =
          (1 - s1) * ((1 - t1) * d0[this.index(i0, j0)]! + t1 * d0[this.index(i0, j0 + 1)]!) +
          s1 * ((1 - t1) * d0[this.index(i0 + 1, j0)]! + t1 * d0[this.index(i0 + 1, j0 + 1)]!);
      }
    }
    this.bounds(mode, d);
  }

  private project(): void {
    const { nx, ny, u, v, p, div } = this;
    const h = 1 / Math.max(nx, ny);
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = this.index(i, j);
        div[k] = -0.5 * h * (u[this.index(i + 1, j)]! - u[this.index(i - 1, j)]! + v[this.index(i, j + 1)]! - v[this.index(i, j - 1)]!);
        p[k] = 0;
      }
    }
    this.bounds(0, div);
    this.bounds(0, p);
    for (let n = 0; n < 16; n++) {
      for (let j = 1; j <= ny; j++) {
        for (let i = 1; i <= nx; i++) {
          const k = this.index(i, j);
          p[k] = (div[k]! + p[this.index(i - 1, j)]! + p[this.index(i + 1, j)]! + p[this.index(i, j - 1)]! + p[this.index(i, j + 1)]!) / 4;
        }
      }
      this.bounds(0, p);
    }
    for (let j = 1; j <= ny; j++) {
      for (let i = 1; i <= nx; i++) {
        const k = this.index(i, j);
        u[k] -= (0.5 * (p[this.index(i + 1, j)]! - p[this.index(i - 1, j)]!)) / h;
        v[k] -= (0.5 * (p[this.index(i, j + 1)]! - p[this.index(i, j - 1)]!)) / h;
      }
    }
    this.bounds(1, u);
    this.bounds(2, v);
  }

  /** One step: forces already splatted in; `fade` is how much dye survives a second, `buoyancy` lifts dense dye. */
  step(dt: number, { fade = 0.6, buoyancy = 0, friction = 0.6 } = {}): void {
    if (dt <= 0) return;
    const { u, v, u0, v0, dyeA, dyeB, scratch } = this;
    if (buoyancy) for (let k = 0; k < this.size; k++) v[k] -= (dyeA[k]! + dyeB[k]!) * buoyancy * dt;
    const keep = Math.pow(friction, dt);
    for (let k = 0; k < this.size; k++) {
      u[k] *= keep;
      v[k] *= keep;
    }
    this.project();
    u0.set(u);
    v0.set(v);
    this.advect(1, u, u0, u0, v0, dt);
    this.advect(2, v, v0, u0, v0, dt);
    this.project();
    const survive = Math.pow(fade, dt);
    scratch.set(dyeA);
    this.advect(0, dyeA, scratch, u, v, dt);
    scratch.set(dyeB);
    this.advect(0, dyeB, scratch, u, v, dt);
    for (let k = 0; k < this.size; k++) {
      dyeA[k] *= survive;
      dyeB[k] *= survive;
    }
  }
}
