'use client';

import { rgba, shade } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { TAU } from '../engine/math';
import { num, str } from '../types';

/** Draws the cup turned by `angle`: a saucer, the cup's body, the handle in front or behind, and the latte's heart. */
function drawCup(ctx: CanvasRenderingContext2D, w: number, h: number, angle: number) {
  const cx = w / 2;
  const s = Math.min(w, h) / 100;
  const top = h * 0.36;
  const rimX = 26 * s;
  const rimY = 7 * s;
  const depth = 34 * s;
  const handleX = Math.sin(angle);
  const front = Math.cos(angle) > 0;

  const saucer = (y: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, y + 3 * s, 42 * s, 10 * s, 0, 0, TAU);
    ctx.fill();
    const g = ctx.createLinearGradient(cx - 42 * s, 0, cx + 42 * s, 0);
    g.addColorStop(0, '#d9d0c1');
    g.addColorStop(0.5, '#fffaf2');
    g.addColorStop(1, '#bdb2a1');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, y, 40 * s, 9 * s, 0, 0, TAU);
    ctx.fill();
  };

  const handle = () => {
    const hx = cx + handleX * (rimX + 6 * s);
    ctx.strokeStyle = front ? '#f6efe3' : '#cfc5b4';
    ctx.lineWidth = 4.2 * s;
    ctx.beginPath();
    ctx.ellipse(hx, top + depth * 0.42, 7.5 * s * (1 - Math.abs(Math.cos(angle)) * 0.6) + 2 * s, 9 * s, 0, 0, TAU);
    ctx.stroke();
  };

  saucer(top + depth + 4 * s);
  if (!front) handle();

  // The body: a bowl from the rim down, shaded so its highlight stays toward the light as it turns.
  const body = ctx.createLinearGradient(cx - rimX, 0, cx + rimX, 0);
  body.addColorStop(0, '#cbbfad');
  body.addColorStop(0.32, '#fffcf6');
  body.addColorStop(0.68, '#efe7da');
  body.addColorStop(1, '#a99d8a');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - rimX, top);
  ctx.bezierCurveTo(cx - rimX, top + depth * 0.9, cx - rimX * 0.6, top + depth, cx, top + depth);
  ctx.bezierCurveTo(cx + rimX * 0.6, top + depth, cx + rimX, top + depth * 0.9, cx + rimX, top);
  ctx.closePath();
  ctx.fill();
  // A gold band that turns with the cup: a mark on the band shows the turn even where the cup is round.
  ctx.strokeStyle = '#d6bc8a';
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.ellipse(cx, top + 4 * s, rimX * 0.985, rimY, 0, 0, Math.PI);
  ctx.stroke();
  const mark = Math.sin(angle + Math.PI / 2);
  if (Math.cos(angle + Math.PI / 2) > 0) {
    ctx.fillStyle = '#d6bc8a';
    ctx.beginPath();
    ctx.arc(cx + mark * rimX * 0.8, top + depth * 0.5, 2.2 * s, 0, TAU);
    ctx.fill();
  }

  // The coffee and its heart, turning in the cup's mouth.
  ctx.fillStyle = '#efe7da';
  ctx.beginPath();
  ctx.ellipse(cx, top, rimX, rimY, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#8a5a36';
  ctx.beginPath();
  ctx.ellipse(cx, top + 0.6 * s, rimX * 0.9, rimY * 0.84, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, top + 0.6 * s);
  ctx.scale(1, rimY / rimX);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(250,240,222,0.95)';
  const k = rimX * 0.0055;
  ctx.beginPath();
  ctx.moveTo(0, 96 * k);
  ctx.bezierCurveTo(-140 * k, 6 * k, -128 * k, -100 * k, 0, -44 * k);
  ctx.bezierCurveTo(128 * k, -100 * k, 140 * k, 6 * k, 0, 96 * k);
  ctx.fill();
  ctx.restore();

  if (front) handle();
}

/**
 * #25 The technique behind scroll-driven product films: frames drawn ahead of time (here a cup turning on its saucer;
 * on a menu, a photographed spin) and one shown for each point of the scroll. `frames` sets how many were drawn; a
 * counter shows which one is on screen.
 */
export default canvasMotion(
  (params) => {
    const total = num(params, 'frames');
    let frames: HTMLCanvasElement[] = [];
    let ratio = 1;
    return {
      resize(width, height) {
        ratio = Math.min(window.devicePixelRatio || 1, 2);
        frames = Array.from({ length: total }, (_, i) => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.scale(ratio, ratio);
            drawCup(ctx, width, height, (i / total) * TAU);
          }
          return canvas;
        });
      },
      draw(ctx, frame) {
        const background = str(frame.params, 'background');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, frame.width, frame.height);
        const glow = ctx.createRadialGradient(frame.width / 2, frame.height * 0.45, 0, frame.width / 2, frame.height * 0.45, frame.width * 0.5);
        glow.addColorStop(0, shade(background, 0.12));
        glow.addColorStop(1, rgba(background, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, frame.width, frame.height);
        const index = Math.min(total - 1, Math.floor(frame.progress * total));
        const image = frames[index];
        if (image) ctx.drawImage(image, 0, 0, frame.width, frame.height);
        // The frame counter, like a film editor's.
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `500 ${Math.max(10, frame.width * 0.022)}px ui-monospace, monospace`;
        ctx.textAlign = 'right';
        ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${total}`, frame.width * 0.95, frame.height * 0.93);
        // Every frame as a tick, the shown one lit.
        const left = frame.width * 0.05;
        const span = frame.width * 0.62;
        for (let i = 0; i < total; i++) {
          ctx.fillStyle = i === index ? '#d6bc8a' : 'rgba(255,255,255,0.18)';
          ctx.fillRect(left + (i / total) * span, frame.height * 0.91, Math.max(1, span / total - 1), i === index ? 6 : 3);
        }
      },
    };
  },
  { rebuild: ['frames'] },
);
