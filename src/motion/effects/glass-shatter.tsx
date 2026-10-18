'use client';

import { rgba, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { clamp, easeInOutCubic, hash, lerp, TAU } from '../engine/math';
import type { Point } from '../engine/shapes';
import { str } from '../types';

const CYCLE = 6;
const RAYS = 11;
const RINGS = 4;

interface Shard {
  points: Point[];
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  spin: number;
  delay: number;
}

/**
 * #149 A pane of glass with the menu's name on it takes a blow: cracks run out from the point of impact in rays and
 * rings, the pieces fall away turning and catching the light, then time runs backward and the pane mends itself.
 */
export default canvasMotion(() => {
  let shards: Shard[] = [];
  let pane = { x: 0, y: 0, w: 0, h: 0 };
  const build = (width: number, height: number) => {
    pane = { x: width * 0.14, y: height * 0.12, w: width * 0.72, h: height * 0.76 };
    const ix = pane.x + pane.w * 0.42;
    const iy = pane.y + pane.h * 0.45;
    const reach = Math.hypot(pane.w, pane.h);
    // Rays from the impact, cut by rings: each cell between two rays and two rings is a shard.
    const angles = Array.from({ length: RAYS }, (_, i) => (i / RAYS) * TAU + (hash(i, 1) - 0.5) * 0.35);
    const radii = [0, ...Array.from({ length: RINGS }, (_, k) => reach * ((k + 1) / RINGS) ** 1.6 * (0.9 + hash(k, 2) * 0.2))];
    shards = [];
    for (let i = 0; i < RAYS; i++) {
      for (let k = 0; k < RINGS; k++) {
        const a0 = angles[i]!;
        const a1 = angles[(i + 1) % RAYS]! + (i === RAYS - 1 ? TAU : 0);
        const r0 = radii[k]!;
        const r1 = radii[k + 1]!;
        const points: Point[] = [
          [ix + Math.cos(a0) * r0, iy + Math.sin(a0) * r0],
          [ix + Math.cos(a0) * r1, iy + Math.sin(a0) * r1],
          [ix + Math.cos(a1) * r1, iy + Math.sin(a1) * r1],
          [ix + Math.cos(a1) * r0, iy + Math.sin(a1) * r0],
        ];
        const cx = points.reduce((s, p) => s + p[0], 0) / 4;
        const cy = points.reduce((s, p) => s + p[1], 0) / 4;
        const out = Math.atan2(cy - iy, cx - ix);
        shards.push({ points, cx, cy, vx: Math.cos(out) * lerp(20, 90, hash(i * 9 + k, 3)), vy: Math.sin(out) * 40 - lerp(20, 80, hash(i * 9 + k, 4)), spin: (hash(i * 9 + k, 5) - 0.5) * 6, delay: k * 0.06 + hash(i, 6) * 0.08 });
      }
    }
  };
  return {
    resize: build,
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      if (!shards.length) build(w, h);
      const tint = str(params, 'color');
      ctx.fillStyle = str(params, 'background');
      ctx.fillRect(0, 0, w, h);
      const local = t % CYCLE;
      // Whole until 1.2 s, falling until 3.6 s, rewinding until 5.4 s, whole again.
      const fall = local < 1.2 ? 0 : local < 3.6 ? (local - 1.2) / 2.4 : 1 - easeInOutCubic(clamp((local - 3.6) / 1.8));
      const cracked = local > 1.05 && local < 5.5;
      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.x, pane.y, pane.w, pane.h);
      ctx.clip();
      for (const shard of shards) {
        const k = clamp(fall * 2.4 - shard.delay * 2);
        const time = k * 1.6;
        const x = shard.vx * time;
        const y = shard.vy * time + 0.5 * 600 * time * time;
        ctx.save();
        ctx.translate(shard.cx + x, shard.cy + y);
        ctx.rotate(shard.spin * time);
        ctx.translate(-shard.cx, -shard.cy);
        ctx.beginPath();
        shard.points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
        const glass = ctx.createLinearGradient(pane.x, pane.y, pane.x + pane.w, pane.y + pane.h);
        glass.addColorStop(0, rgba('#ffffff', 0.16));
        glass.addColorStop(0.5, rgba(tint, 0.1));
        glass.addColorStop(1, rgba('#ffffff', 0.08));
        ctx.fillStyle = glass;
        ctx.fill();
        if (cracked) {
          ctx.strokeStyle = rgba('#ffffff', 0.55 + 0.4 * Math.sin(shard.spin * time + 1) ** 2 * k);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
      // The wordmark painted on the glass shows only while the pane is whole.
      ctx.globalAlpha = 1 - clamp(fall * 6);
      ctx.fillStyle = tint;
      ctx.font = `600 ${Math.min(w, h) * 0.12}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Buzzify', w / 2, h / 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = shade(tint, -0.2);
      ctx.lineWidth = 2;
      ctx.strokeRect(pane.x, pane.y, pane.w, pane.h);
    },
  };
}, { still: 0.6 });
