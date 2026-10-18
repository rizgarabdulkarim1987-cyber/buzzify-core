'use client';

import { canvasMotion } from '../engine/define';
import { clamp, hash, lerp, smoothstep, TAU } from '../engine/math';
import { num, str } from '../types';

const CYCLE = 6;
const STRANDS = 9;

/** The toppings on the pie: pepperoni and basil at fixed places, in the pizza's own units (radius 1). */
const TOPPINGS = Array.from({ length: 14 }, (_, i) => ({ a: hash(i, 1) * TAU, d: 0.25 + hash(i, 2) * 0.62, basil: i % 4 === 0 }));

/**
 * #57 A slice lifted from a hot pizza: it rises and tilts away, strings of melted cheese stretch between it and the pie,
 * thinning and sagging as they lengthen, and snap one by one. The slice settles back and is lifted again.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    ctx.fillStyle = str(params, 'background');
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    const cx = w * 0.5;
    const cy = h * 0.66;
    const R = s * 0.36;
    const squash = 0.42;
    const local = t % CYCLE;
    const lift = smoothstep(0.5, 2.6, local) * (1 - smoothstep(4.6, 5.6, local));
    const stretch = num(params, 'stretch');
    // The pie, seen at an angle: crust, sauce, cheese, toppings.
    const pie = (alpha: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, squash);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#c98a4a';
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#b8401f';
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#f2cf6a';
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.86, 0, TAU);
      ctx.fill();
      for (const top of TOPPINGS) {
        ctx.fillStyle = top.basil ? '#4f7a2a' : '#a8321c';
        ctx.beginPath();
        ctx.arc(Math.cos(top.a) * top.d * R * 0.86, Math.sin(top.a) * top.d * R * 0.86, R * (top.basil ? 0.06 : 0.09), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    };
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * squash * 0.25, R * 1.08, R * squash * 1.05, 0, 0, TAU);
    ctx.fill();
    pie(1);
    // The slice's wedge, cut from the front of the pie: its gap is shown as the pan beneath.
    const wedge = (draw: () => void) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, squash);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, Math.PI * 0.32, Math.PI * 0.68);
      ctx.closePath();
      draw();
      ctx.restore();
    };
    wedge(() => {
      ctx.fillStyle = '#3a2a20';
      ctx.fill();
    });
    // Where the slice is now: lifted up and toward the viewer, tilting.
    const up = lift * s * 0.32;
    const tilt = lift * 0.25;
    // Strings of cheese from the slice's cut edges to the pie, snapping in turn as the slice climbs.
    for (let i = 0; i < STRANDS; i++) {
      const k = i / (STRANDS - 1);
      const along = lerp(0.12, 0.95, k);
      const side = i % 2 === 0 ? 0.32 : 0.68;
      const a = Math.PI * side;
      const px = cx + Math.cos(a) * R * along * 0.98;
      const py = cy + Math.sin(a) * R * along * squash;
      const snapAt = lerp(0.45, 1.05, hash(i, 3)) * stretch;
      const held = lift < snapAt;
      const reach = held ? up : up * clamp(1 - (lift - snapAt) * 6);
      if (reach <= s * 0.01) continue;
      const thin = clamp(1 - reach / (s * 0.38 * stretch));
      ctx.strokeStyle = '#f6d47a';
      ctx.lineCap = 'round';
      ctx.lineWidth = s * lerp(0.004, 0.016, thin);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + (cx - px) * 0.1, py - reach * 0.4 + s * 0.03 * (1 - thin), px, py - reach);
      ctx.stroke();
    }
    // The slice itself: the same pie drawn through the wedge, lifted, and seen a little more from above as it tilts up.
    ctx.save();
    ctx.translate(0, -up);
    ctx.translate(cx, cy);
    ctx.rotate(-tilt * 0.3);
    ctx.scale(1, squash + lift * 0.18);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, Math.PI * 0.32, Math.PI * 0.68);
    ctx.closePath();
    ctx.clip();
    ctx.scale(1, 1 / (squash + lift * 0.18));
    ctx.translate(-cx, -cy);
    pie(1);
    ctx.restore();
  },
}), { still: 2.4 });
