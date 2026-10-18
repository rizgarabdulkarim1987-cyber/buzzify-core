/** Outlines as point lists, for motions that morph one shape into another or gather particles into a word. */

export type Point = [number, number];

/** The signed area of a closed outline: positive when it runs clockwise on screen (y down). */
function area(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * `n` points evenly spaced along a closed outline, starting at its top-most point and running clockwise. Two outlines
 * resampled this way line up point for point, so blending them morphs one into the other without twisting.
 */
export function resample(outline: readonly Point[], n: number): Point[] {
  let points = [...outline];
  if (area(points) < 0) points.reverse();
  let start = 0;
  points.forEach(([, y], i) => {
    if (y < points[start]![1]) start = i;
  });
  points = [...points.slice(start), ...points.slice(0, start)];
  const lengths = [0];
  for (let i = 1; i <= points.length; i++) {
    const [x1, y1] = points[i - 1]!;
    const [x2, y2] = points[i % points.length]!;
    lengths.push(lengths[i - 1]! + Math.hypot(x2 - x1, y2 - y1));
  }
  const total = lengths[lengths.length - 1]!;
  const out: Point[] = [];
  let segment = 0;
  for (let k = 0; k < n; k++) {
    const at = (k / n) * total;
    while (lengths[segment + 1]! < at) segment++;
    const [x1, y1] = points[segment]!;
    const [x2, y2] = points[(segment + 1) % points.length]!;
    const span = lengths[segment + 1]! - lengths[segment]! || 1;
    const t = (at - lengths[segment]!) / span;
    out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return out;
}

/** A closed outline from a parametric curve, `steps` points around. */
export function parametric(steps: number, at: (t: number) => Point): Point[] {
  return Array.from({ length: steps }, (_, i) => at((i / steps) * Math.PI * 2));
}

/** The classic heart curve, about two units across, centred. */
export function heartOutline(steps = 240): Point[] {
  return parametric(steps, (t) => [(16 * Math.sin(t) ** 3) / 17, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17]);
}

/** A coffee bean's outline: an egg slightly pinched at its waist. */
export function beanOutline(steps = 240): Point[] {
  return parametric(steps, (t) => {
    const r = 1 - 0.06 * Math.cos(2 * t) + 0.04 * Math.sin(t);
    return [Math.cos(t) * 0.66 * r, Math.sin(t) * 0.92 * r];
  });
}

/** A cup seen from the side, handle on the right: its silhouette as one closed outline. */
export function cupOutline(): Point[] {
  const points: Point[] = [];
  // Rim, left to right.
  for (let i = 0; i <= 20; i++) points.push([-0.8 + (i / 20) * 1.6, -0.55]);
  // Down the right side to the handle, around the handle's outer edge, and back.
  points.push([0.8, -0.4]);
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI / 2 + (i / 24) * Math.PI;
    points.push([0.78 + Math.cos(a) * 0.34, -0.12 + Math.sin(a) * 0.3]);
  }
  for (let i = 24; i >= 0; i--) {
    const a = -Math.PI / 2 + (i / 24) * Math.PI;
    points.push([0.78 + Math.cos(a) * 0.18, -0.12 + Math.sin(a) * 0.15]);
  }
  // The bowl of the cup, right to left.
  for (let i = 0; i <= 30; i++) {
    const a = (i / 30) * Math.PI;
    points.push([Math.cos(a) * 0.78, -0.35 + Math.sin(a) * 0.78]);
  }
  return points;
}

/**
 * Points inside the letters of `text`, drawn in the `family` at weight 600 into a box of `width` × `height` and read back every `step`
 * pixels. The text is drawn whole, so Arabic and Sorani letters join as they do in print.
 */
export function textPoints(text: string, family: string, width: number, height: number, step: number, sizeOf = 0.36): Point[] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  let size = Math.min(height * sizeOf, width * 0.22);
  ctx.font = `600 ${size}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (measured > width * 0.86) size *= (width * 0.86) / measured;
  ctx.font = `600 ${size}px ${family}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = /[؀-ۿ]/.test(text) ? 'rtl' : 'ltr';
  ctx.fillText(text, width / 2, height / 2);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const points: Point[] = [];
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if (data[(y * canvas.width + x) * 4 + 3]! > 128) points.push([x, y]);
    }
  }
  return points;
}
