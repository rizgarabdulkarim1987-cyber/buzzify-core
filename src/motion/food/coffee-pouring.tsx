'use client';

import { rgb, rgba, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { LiquidField } from '../engine/liquid';
import { clamp, easeInOutCubic, hash, smoothstep, TAU } from '../engine/math';
import { str } from '../types';

const CYCLE = 7.5;

/**
 * #46 Coffee poured from a pot: the pot tips, a glossy stream falls and wavers, the cup fills with a rippling surface
 * and a little splash where the stream lands; the pot rights itself, the cup steams, and the pour begins again.
 */
export default canvasMotion(() => {
  let liquid: LiquidField | null = null;
  return {
    resize(width, height) {
      liquid = new LiquidField(width, height, 2.5);
    },
    draw(ctx, frame) {
      const { width: w, height: h, t, params } = frame;
      const coffee = str(params, 'color');
      const background = str(params, 'background');
      const local = t % CYCLE;
      const s = Math.min(w, h);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
      const tip = smoothstep(0.2, 1.1, local) * (1 - smoothstep(5.2, 6.1, local));
      const flowing = smoothstep(0.9, 1.3, local) * (1 - smoothstep(5, 5.5, local));
      const level = easeInOutCubic(clamp((local - 1.2) / 4.2));
      const cupX = w * 0.58;
      const cupTop = h * 0.56;
      const cupW = s * 0.36;
      const cupH = s * 0.3;
      const surface = cupTop + cupH * (0.92 - level * 0.7);
      // The pot, tipping about its base.
      const potX = cupX - s * 0.3;
      const potY = h * 0.3;
      ctx.save();
      ctx.translate(potX, potY);
      ctx.rotate(tip * 0.75);
      const pot = ctx.createLinearGradient(-s * 0.1, 0, s * 0.1, 0);
      pot.addColorStop(0, '#5f5a55');
      pot.addColorStop(0.45, '#d9d4cc');
      pot.addColorStop(1, '#55504b');
      ctx.fillStyle = pot;
      ctx.beginPath();
      ctx.moveTo(-s * 0.09, -s * 0.12);
      ctx.lineTo(s * 0.09, -s * 0.12);
      ctx.lineTo(s * 0.12, s * 0.1);
      ctx.lineTo(-s * 0.12, s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.09, -s * 0.08);
      ctx.lineTo(s * 0.2, -s * 0.12);
      ctx.lineTo(s * 0.2, -s * 0.1);
      ctx.lineTo(s * 0.1, -s * 0.04);
      ctx.fill();
      ctx.strokeStyle = '#2d2a27';
      ctx.lineWidth = s * 0.018;
      ctx.beginPath();
      ctx.arc(-s * 0.14, -s * 0.01, s * 0.06, Math.PI * 0.6, Math.PI * 1.45);
      ctx.stroke();
      ctx.restore();
      // Where the spout's tip is now, after the tip.
      const spoutX = potX + Math.cos(tip * 0.75) * s * 0.2 - Math.sin(tip * 0.75) * -s * 0.11;
      const spoutY = potY + Math.sin(tip * 0.75) * s * 0.2 + Math.cos(tip * 0.75) * -s * 0.11;
      // The cup behind the coffee, the coffee, then the cup's front rim.
      ctx.fillStyle = '#e9e2d6';
      ctx.beginPath();
      ctx.ellipse(cupX, cupTop, cupW / 2, s * 0.035, 0, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cupX - cupW / 2, cupTop);
      ctx.bezierCurveTo(cupX - cupW / 2, cupTop + cupH, cupX - cupW * 0.25, cupTop + cupH, cupX, cupTop + cupH);
      ctx.bezierCurveTo(cupX + cupW * 0.25, cupTop + cupH, cupX + cupW / 2, cupTop + cupH, cupX + cupW / 2, cupTop);
      ctx.closePath();
      ctx.clip();
      const body = ctx.createLinearGradient(0, surface, 0, cupTop + cupH);
      body.addColorStop(0, shade(coffee, 0.35));
      body.addColorStop(0.08, coffee);
      body.addColorStop(1, shade(coffee, -0.5));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(cupX - cupW, h);
      for (let x = -cupW; x <= cupW; x += 3) {
        const ripple = Math.sin(x * 0.12 - t * 8) * s * 0.004 * flowing * Math.exp(-Math.abs(x) / (cupW * 0.4));
        ctx.lineTo(cupX + x, surface + ripple);
      }
      ctx.lineTo(cupX + cupW, h);
      ctx.fill();
      ctx.restore();
      const china = ctx.createLinearGradient(cupX - cupW / 2, 0, cupX + cupW / 2, 0);
      china.addColorStop(0, '#cfc6b8');
      china.addColorStop(0.3, '#fffdf8');
      china.addColorStop(1, '#b8ad9c');
      ctx.strokeStyle = china;
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      ctx.moveTo(cupX - cupW / 2, cupTop);
      ctx.bezierCurveTo(cupX - cupW / 2, cupTop + cupH, cupX - cupW * 0.25, cupTop + cupH, cupX, cupTop + cupH);
      ctx.bezierCurveTo(cupX + cupW * 0.25, cupTop + cupH, cupX + cupW / 2, cupTop + cupH, cupX + cupW / 2, cupTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cupX + cupW / 2 + s * 0.04, cupTop + cupH * 0.4, s * 0.06, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      // The stream and its splash, as glossy liquid.
      if (flowing > 0.02 && liquid) {
        const blobs = [];
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          const a = i / steps;
          const b = (i + 1) / steps;
          const wobble = (k: number) => Math.sin(t * 7 + k * 6) * s * 0.006 * k;
          const x = (k: number) => spoutX + (cupX - s * 0.04 - spoutX) * k * k + wobble(k);
          const y = (k: number) => spoutY + (surface - spoutY) * k;
          blobs.push({ x: x(a), y: y(a), x2: x(b), y2: y(b), r: s * 0.012 * flowing * (1 - a * 0.35) });
        }
        for (let i = 0; i < 6; i++) {
          const life = (t * 1.6 + hash(i, 1)) % 1;
          const angle = Math.PI * (0.15 + 0.7 * hash(i, 2));
          blobs.push({ x: cupX - s * 0.04 + Math.cos(angle) * life * s * 0.06, y: surface - Math.sin(angle) * Math.sin(life * Math.PI) * s * 0.05, r: s * 0.006 * (1 - life) * flowing });
        }
        liquid.draw(ctx, blobs, { color: rgb(shade(coffee, 0.1)), gloss: 0.9 }, w, h);
      }
      // Steam once the cup is full.
      const steam = smoothstep(5, 6, local) * (1 - smoothstep(7, 7.5, local));
      if (steam > 0) {
        ctx.strokeStyle = rgba('#ffffff', 0.35 * steam);
        ctx.lineWidth = s * 0.012;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          for (let k = 0; k <= 12; k++) {
            const y = cupTop - k * s * 0.018;
            const x = cupX + (i - 1) * s * 0.06 + Math.sin(k * 0.6 + t * 2 + i) * s * 0.015;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    },
  };
}, { still: 3.5 });
