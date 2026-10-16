import type { RailDish } from '@/lib/rail';
import { dishCloud, flightPoint, grainSeeds, type DishCloud, type Flight } from './grains-math';

/**
 * Draws the grain dishes rail on a 2D canvas laid over the rail: the active category's dish as a few hundred
 * gold-lit grains turning slowly above its name. When the category changes the grains melt off the old dish,
 * swirl along the rail and settle into the new one. No 3D library: a small projection and round dots.
 */

const COUNT = 640;
/** CSS pixels per dish unit: a dish is about this wide and three quarters as tall. */
const SCALE = 21;
const MORPH_MS = 1500;
/** About 30 frames a second while the dish only turns. */
const IDLE_FRAME_MS = 32;
/** Lift the dish's base this far above the bottom of its slot so the near rim stays clear of the name. */
const BASE_LIFT = 8;
const TILT = 0.42;
const GOLD = [0.94, 0.8, 0.55] as const;

export interface GrainEngine {
  /** Form `dish` above `slot` (an element in the rail), melting whatever dish is showing into it. */
  show(dish: RailDish, slot: HTMLElement): void;
  dispose(): void;
}

export function createGrainEngine(canvas: HTMLCanvasElement): GrainEngine | null {
  const context = canvas.getContext('2d');
  if (!context) return null;

  const seeds = grainSeeds(COUNT);
  const clouds = new Map<RailDish, DishCloud>();
  const cloudOf = (dish: RailDish) => {
    let cloud = clouds.get(dish);
    if (!cloud) {
      cloud = dishCloud(dish, COUNT);
      clouds.set(dish, cloud);
    }
    return cloud;
  };

  // Where each grain is now, so a new change of category melts from wherever the grains happen to be.
  const now = { positions: new Float32Array(COUNT * 3), colors: new Float32Array(COUNT * 3), anchors: new Float32Array(COUNT * 2) };
  let from = { positions: new Float32Array(COUNT * 3), colors: new Float32Array(COUNT * 3), anchors: new Float32Array(COUNT * 2) };
  let to: DishCloud | null = null;
  let slot: HTMLElement | null = null;
  let start = 0;
  let lastDraw = -Infinity;
  let visible = true;
  let frame = 0;
  const flight: Flight = { x: 0, y: 0, z: 0, e: 0, s: 0 };

  let width = 0;
  let height = 0;
  const resize = () => {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastDraw = -Infinity;
  };
  const sizes = new ResizeObserver(resize);
  sizes.observe(canvas);
  resize();
  const seen = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  });
  seen.observe(canvas);

  const anchorOf = (element: HTMLElement): [number, number] => {
    const box = element.getBoundingClientRect();
    const origin = canvas.getBoundingClientRect();
    return [box.left + box.width / 2 - origin.left, box.bottom - BASE_LIFT - origin.top];
  };

  const draw = (time: number) => {
    frame = requestAnimationFrame(draw);
    if (!to || !slot || !visible) return;
    const progress = Math.min(1, (time - start) / MORPH_MS);
    if (progress >= 1 && time - lastDraw < IDLE_FRAME_MS) return;
    lastDraw = time;

    const [ax, ay] = anchorOf(slot);
    const turn = time * 0.0005;
    const cy = Math.cos(turn);
    const sy = Math.sin(turn);
    const ct = Math.cos(TILT);
    const st = Math.sin(TILT);
    context.clearRect(0, 0, width, height);

    for (let k = 0; k < COUNT; k++) {
      const i = k * 3;
      flightPoint(
        from.positions[i]!, from.positions[i + 1]!, from.positions[i + 2]!,
        to.positions[i]!, to.positions[i + 1]!, to.positions[i + 2]!,
        seeds, k, progress, flight,
      );
      const { x, y, z, e, s } = flight;
      // Grains travel along the rail with their own progress, so a change of category streams like a comet.
      const bx = from.anchors[k * 2]! + (ax - from.anchors[k * 2]!) * e;
      const by = from.anchors[k * 2 + 1]! + (ay - from.anchors[k * 2 + 1]!) * e;
      const r = from.colors[i]! + (to.colors[i]! - from.colors[i]!) * e;
      const g = from.colors[i + 1]! + (to.colors[i + 1]! - from.colors[i + 1]!) * e;
      const b = from.colors[i + 2]! + (to.colors[i + 2]! - from.colors[i + 2]!) * e;
      now.positions[i] = x;
      now.positions[i + 1] = y;
      now.positions[i + 2] = z;
      now.colors[i] = r;
      now.colors[i + 1] = g;
      now.colors[i + 2] = b;
      now.anchors[k * 2] = bx;
      now.anchors[k * 2 + 1] = by;

      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = y * ct - z1 * st;
      const depth = z1 * ct + y * st;
      const perspective = 5 / (5 - depth);
      const light = (0.62 + 0.38 * Math.min(1, Math.max(0, (depth + 1) / 2))) * 255;
      const glint = 0.35 * s;
      const radius = 0.8 * perspective * (1 - 0.3 * s);
      context.fillStyle = `rgb(${((r * (1 - glint) + GOLD[0] * glint) * light) | 0},${((g * (1 - glint) + GOLD[1] * glint) * light) | 0},${((b * (1 - glint) + GOLD[2] * glint) * light) | 0})`;
      context.beginPath();
      context.arc(bx + x1 * SCALE * perspective, by - y2 * SCALE * perspective, radius, 0, Math.PI * 2);
      context.fill();
    }
  };
  frame = requestAnimationFrame(draw);

  return {
    show(dish, element) {
      const target = cloudOf(dish);
      if (!to) {
        // The first dish rises out of its base.
        const [ax, ay] = anchorOf(element);
        from = { positions: target.positions.slice(), colors: target.colors.slice(), anchors: new Float32Array(COUNT * 2) };
        for (let k = 0; k < COUNT; k++) {
          from.positions[k * 3] = from.positions[k * 3]! * 0.9;
          from.positions[k * 3 + 1] = 0;
          from.positions[k * 3 + 2] = from.positions[k * 3 + 2]! * 0.9;
          from.anchors[k * 2] = ax;
          from.anchors[k * 2 + 1] = ay;
        }
      } else {
        from = { positions: now.positions.slice(), colors: now.colors.slice(), anchors: now.anchors.slice() };
      }
      to = target;
      slot = element;
      start = performance.now();
    },
    dispose() {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      seen.disconnect();
      context.clearRect(0, 0, width, height);
    },
  };
}
