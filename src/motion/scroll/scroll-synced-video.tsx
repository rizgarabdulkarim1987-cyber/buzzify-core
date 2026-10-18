'use client';

import { useMotionValueEvent, type MotionValue } from 'motion/react';
import { useEffect, useRef } from 'react';
import { mix, rgba } from '../engine/color';
import { canvasMotion } from '../engine/define';
import { clamp, hash, smoothstep, TAU } from '../engine/math';
import { bool, str } from '../types';

/** The film's length in seconds: the timecode runs from 0 to this as the scroll goes from top to bottom. */
const LENGTH = 12;

/**
 * A real video that plays with the scroll: its time follows `progress` (0 to 1), seeking as the reader scrolls. For a
 * menu with a filmed pour or a chef's moment. The video should be encoded with frequent keyframes so seeking is smooth.
 */
export function ScrollVideo({ src, progress, poster }: { src: string; progress: MotionValue<number>; poster?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const seek = (p: number) => {
    const element = video.current;
    if (element && Number.isFinite(element.duration)) element.currentTime = clamp(p) * element.duration;
  };
  useMotionValueEvent(progress, 'change', seek);
  useEffect(() => seek(progress.get()));
  return <video ref={video} src={src} poster={poster} muted playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

function timecode(seconds: number): string {
  const s = Math.floor(seconds);
  const frames = Math.floor((seconds - s) * 24);
  return `00:00:${String(s).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

/**
 * #28 A film that plays forward and back with the scroll: a shot of espresso pouring into a glass cup, with the film's
 * grain, its letterbox and a timecode that follows the scroll. The motion draws its own film so the gallery needs no
 * file; `ScrollVideo` in the same file does the same for a real video.
 */
export default canvasMotion(() => ({
  draw(ctx, frame) {
    const { width: w, height: h, params } = frame;
    const time = frame.progress * LENGTH;
    const accent = str(params, 'accent');
    const background = str(params, 'background');
    // The shot: a dark bar, a portafilter above, a glass cup below it.
    const room = ctx.createLinearGradient(0, 0, 0, h);
    room.addColorStop(0, mix(background, '#3a2a1c', 0.6));
    room.addColorStop(1, background);
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const s = Math.min(w, h) / 100;
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(cx - 26 * s, h * 0.12, 52 * s, 10 * s);
    ctx.fillStyle = '#4a4540';
    ctx.fillRect(cx - 9 * s, h * 0.12 + 10 * s, 18 * s, 5 * s);
    const cupTop = h * 0.46;
    const cupBottom = h * 0.8;
    const level = smoothstep(1.5, 10.5, time);
    const pouring = time > 1.2 && time < 10.8;
    // The stream: two threads that thin as the shot ends.
    if (pouring) {
      const thickness = (1 - smoothstep(8.5, 10.8, time)) * 1.6 * s + 0.4 * s;
      ctx.strokeStyle = '#6b3a1c';
      ctx.lineCap = 'round';
      [-3, 3].forEach((dx, i) => {
        ctx.lineWidth = thickness * (1 + 0.2 * Math.sin(time * 9 + i));
        ctx.beginPath();
        ctx.moveTo(cx + dx * s, h * 0.12 + 15 * s);
        ctx.quadraticCurveTo(cx + dx * 0.6 * s, (h * 0.12 + 15 * s + cupBottom) / 2, cx + dx * 0.3 * s, cupBottom - level * (cupBottom - cupTop) * 0.8);
        ctx.stroke();
      });
    }
    // The glass cup and the coffee rising in it, crema on top.
    const liquidTop = cupBottom - level * (cupBottom - cupTop) * 0.8;
    const coffee = ctx.createLinearGradient(0, liquidTop, 0, cupBottom);
    coffee.addColorStop(0, '#c58a52');
    coffee.addColorStop(0.18, '#6b3a1c');
    coffee.addColorStop(1, '#2a140a');
    ctx.fillStyle = coffee;
    ctx.fillRect(cx - 17 * s, liquidTop, 34 * s, cupBottom - liquidTop);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2 * s;
    ctx.strokeRect(cx - 17 * s, cupTop, 34 * s, cupBottom - cupTop);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(cx - 14 * s, cupTop + 2 * s, 3 * s, cupBottom - cupTop - 4 * s);
    // Film: grain, a vignette, the letterbox and the timecode.
    if (bool(params, 'grain')) {
      const seed = Math.floor(time * 24);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 260; i++) ctx.fillRect(hash(i, seed) * w, hash(i, seed + 7) * h, 1.5, 1.5);
    }
    const vignette = ctx.createRadialGradient(cx, h / 2, Math.min(w, h) * 0.3, cx, h / 2, Math.max(w, h) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    const bar = h * 0.09;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    ctx.fillStyle = accent;
    ctx.font = `500 ${Math.max(9, bar * 0.42)}px ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(timecode(time), w * 0.04, h - bar / 2);
    ctx.fillStyle = rgba(accent, 0.25);
    ctx.fillRect(w * 0.42, h - bar / 2 - 1, w * 0.54, 2);
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.42, h - bar / 2 - 1, w * 0.54 * frame.progress, 2);
    ctx.beginPath();
    ctx.arc(w * 0.42 + w * 0.54 * frame.progress, h - bar / 2, 3.5, 0, TAU);
    ctx.fill();
  },
}));
