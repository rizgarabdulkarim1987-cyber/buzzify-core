import type { RGB } from './color';

/**
 * Metaballs for thick liquids: chocolate, honey, milk, melting cream. Each blob (a ball, or a capsule between two
 * points) adds `r² / d²` to a field on a coarse grid; the liquid is wherever the field passes 1. The field's slope
 * gives a normal, so the liquid is shaded with a soft body and a glossy highlight, then scaled up smoothly.
 */
export interface Blob {
  x: number;
  y: number;
  r: number;
  /** A second point turns the ball into a capsule: a stream, a drip's neck. */
  x2?: number;
  y2?: number;
}

export interface LiquidStyle {
  color: RGB;
  /** 0 matte to 1 glossy. */
  gloss: number;
  /** How see-through the body is at its thin edges, 0 to 1 (honey is, chocolate is not). */
  clarity?: number;
}

export class LiquidField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private field: Float32Array;
  private image: ImageData;
  readonly cols: number;
  readonly rows: number;
  private scale: number;

  /** A field for a `width` × `height` drawing, `cell` CSS pixels per grid cell. */
  constructor(width: number, height: number, cell = 3) {
    this.cols = Math.max(8, Math.ceil(width / cell));
    this.rows = Math.max(8, Math.ceil(height / cell));
    this.scale = width / this.cols;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.ctx = this.canvas.getContext('2d')!;
    this.field = new Float32Array(this.cols * this.rows);
    this.image = this.ctx.createImageData(this.cols, this.rows);
  }

  /** Adds blobs (in CSS pixels) to the field, then draws the liquid onto `target` at the full size. */
  draw(target: CanvasRenderingContext2D, blobs: readonly Blob[], style: LiquidStyle, width: number, height: number): void {
    const { cols, rows, field, scale } = this;
    field.fill(0);
    for (const blob of blobs) {
      const r = blob.r / scale;
      const ax = blob.x / scale;
      const ay = blob.y / scale;
      const bx = (blob.x2 ?? blob.x) / scale;
      const by = (blob.y2 ?? blob.y) / scale;
      const reach = r * 3.2;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
      const x1 = Math.min(cols - 1, Math.ceil(Math.max(ax, bx) + reach));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
      const y1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by) + reach));
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          let px = ax;
          let py = ay;
          if (length2 > 0) {
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2));
            px = ax + dx * t;
            py = ay + dy * t;
          }
          const d2 = (x - px) * (x - px) + (y - py) * (y - py) + 0.0001;
          field[y * cols + x] += r2 / d2;
        }
      }
    }
    const data = this.image.data;
    const [cr, cg, cb] = style.color;
    const clarity = style.clarity ?? 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const f = field[i]!;
        const k = i * 4;
        if (f < 0.85) {
          data[k + 3] = 0;
          continue;
        }
        const edge = Math.min(1, (f - 0.85) / 0.3);
        // The slope of the field, pointing out of the liquid: a normal for shading.
        const gx = (field[i + (x < cols - 1 ? 1 : 0)]! - field[i - (x > 0 ? 1 : 0)]!) * 0.5;
        const gy = (field[i + (y < rows - 1 ? cols : 0)]! - field[i - (y > 0 ? cols : 0)]!) * 0.5;
        const len = Math.hypot(gx, gy) + 1e-4;
        const nx = -gx / len;
        const ny = -gy / len;
        const flat = Math.min(1, 1.2 / (len + 0.4));
        // Light from the upper left; a soft body shade and a sharp highlight near the rim.
        const lambert = 0.68 + 0.32 * (-nx * 0.6 - ny * 0.8) * (1 - flat);
        const rim = Math.max(0, -nx * 0.55 - ny * 0.83);
        const spec = style.gloss * Math.pow(rim, 18) * (1 - flat) * 255;
        data[k] = Math.min(255, cr * lambert + spec);
        data[k + 1] = Math.min(255, cg * lambert + spec);
        data[k + 2] = Math.min(255, cb * lambert + spec);
        data[k + 3] = 255 * edge * (1 - clarity * 0.35 * (1 - Math.min(1, (f - 0.85) * 0.6)));
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(this.canvas, 0, 0, width, height);
  }
}
