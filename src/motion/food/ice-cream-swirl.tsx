'use client';

import { shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { clamp, lerp, smoothstep, TAU } from '../engine/math';
import { str } from '../types';

const CYCLE = 7;
const TURNS = 3.2;

/**
 * #55 Soft serve piped onto a cone: the swirl climbs in a tightening spiral, each pass of the ribbon lit along its top
 * and shaded under its lip, and finishes in a curled tip. It holds, and is piped again.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, t, params } = frame;
    const cream = str(params, 'color');
    const wafer = str(params, 'accent');
    ctx.fillStyle = str(params, 'background');
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    const cx = w / 2;
    const base = h * 0.6;
    const local = t % CYCLE;
    const piped = clamp(smoothstep(0.3, 4.5, local) * 1.02);
    const fade = 1 - smoothstep(6.2, 7, local);
    // The cone.
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.13, base);
    ctx.lineTo(cx + s * 0.13, base);
    ctx.lineTo(cx, base + s * 0.34);
    ctx.closePath();
    const bake = ctx.createLinearGradient(cx - s * 0.13, 0, cx + s * 0.13, 0);
    bake.addColorStop(0, shade(wafer, -0.2));
    bake.addColorStop(0.5, shade(wafer, 0.15));
    bake.addColorStop(1, shade(wafer, -0.3));
    ctx.fillStyle = bake;
    ctx.fill();
    ctx.globalAlpha = fade;
    // The swirl: the ribbon's passes drawn from the bottom up, so each sits on the one below.
    const steps = 140;
    const drawn = Math.floor(steps * piped);
    for (let i = 0; i < drawn; i++) {
      const a = i / steps;
      const angle = a * TURNS * TAU;
      const radius = s * lerp(0.15, 0.025, a ** 1.1);
      const y = base - s * 0.02 - a * s * 0.3;
      const x = cx + Math.sin(angle) * radius;
      const front = Math.cos(angle);
      const thickness = s * lerp(0.07, 0.035, a);
      const shine = ctx.createLinearGradient(0, y - thickness, 0, y + thickness);
      shine.addColorStop(0, shade(cream, 0.5));
      shine.addColorStop(0.45, cream);
      shine.addColorStop(1, shade(cream, -0.22 - (front < 0 ? 0.08 : 0)));
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.ellipse(x, y, thickness * 1.1, thickness * 0.72, 0, 0, TAU);
      ctx.fill();
    }
    // The curl at the tip.
    if (piped >= 1) {
      ctx.fillStyle = cream;
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.012, base - s * 0.34, s * 0.02, s * 0.03, 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
}), { still: 5 });
