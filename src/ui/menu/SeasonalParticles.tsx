'use client';

import { useEffect, useRef } from 'react';
import type { SeasonEffect } from '@/server/domain/seasons';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';

/**
 * The menu's seasonal effect (docs/superpowers/specs/2026-11-01-project-6-seasonal-particles-design.md): a few light particles
 * drifting over every page, never catching a tap. It draws nothing for a guest who asked their device for less motion, stops while
 * the tab is hidden, and uses fewer particles on a small screen.
 */

interface Look {
  /** Particle size range in px. */
  size: [number, number];
  /** Fall speed range, px per second (negative rises). */
  fall: [number, number];
  /** Side drift amplitude in px and its speed. */
  sway: number;
  spin: number;
  colors: string[];
  shape: 'dot' | 'leaf' | 'petal' | 'spark' | 'strip';
}

const LOOKS: Record<SeasonEffect, Look> = {
  snow: { size: [2, 5], fall: [30, 70], sway: 24, spin: 0, colors: ['#ffffff', '#e8f1ff'], shape: 'dot' },
  leaves: { size: [8, 14], fall: [40, 90], sway: 50, spin: 2, colors: ['#c4622d', '#d98e2b', '#a8431f', '#8a6d1e'], shape: 'leaf' },
  petals: { size: [7, 12], fall: [25, 60], sway: 40, spin: 1.5, colors: ['#f7c6d0', '#f3a6b8', '#fde2e8'], shape: 'petal' },
  sparks: { size: [1.5, 3.5], fall: [-80, -30], sway: 14, spin: 0, colors: ['#ffd36e', '#ffb347', '#fff1c1'], shape: 'spark' },
  confetti: { size: [6, 10], fall: [60, 120], sway: 30, spin: 4, colors: ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5'], shape: 'strip' },
};

interface Particle {
  x: number;
  y: number;
  size: number;
  fall: number;
  phase: number;
  swaySpeed: number;
  angle: number;
  color: string;
}

const between = (range: [number, number]) => range[0] + Math.random() * (range[1] - range[0]);

function spawn(look: Look, width: number, height: number, anywhere: boolean): Particle {
  return {
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : look.fall[0] < 0 ? height + 10 : -10,
    size: between(look.size),
    fall: between(look.fall),
    phase: Math.random() * Math.PI * 2,
    swaySpeed: 0.4 + Math.random() * 0.8,
    angle: Math.random() * Math.PI * 2,
    color: look.colors[Math.floor(Math.random() * look.colors.length)]!,
  };
}

function draw(ctx: CanvasRenderingContext2D, look: Look, p: Particle, x: number): void {
  ctx.save();
  ctx.translate(x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = p.color;
  ctx.globalAlpha = look.shape === 'spark' ? 0.85 : 0.9;
  const s = p.size;
  ctx.beginPath();
  if (look.shape === 'leaf') ctx.ellipse(0, 0, s, s * 0.5, 0, 0, Math.PI * 2);
  else if (look.shape === 'petal') ctx.ellipse(0, 0, s * 0.5, s, 0, 0, Math.PI * 2);
  else if (look.shape === 'strip') ctx.rect(-s / 2, -s / 4, s, s / 2);
  else ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function SeasonalParticles({ effect }: { effect: SeasonEffect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || reduced) return;
    const look = LOOKS[effect];
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let frame = 0;
    let last = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = width < 640 ? 22 : 42;
      particles = Array.from({ length: count }, () => spawn(look, width, height, true));
    };

    const step = (time: number) => {
      const dt = last === 0 ? 0 : Math.min((time - last) / 1000, 0.05);
      last = time;
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i]!;
        p.y += p.fall * dt;
        p.phase += p.swaySpeed * dt;
        p.angle += look.spin * dt;
        const offscreen = look.fall[0] < 0 ? p.y < -12 : p.y > height + 12;
        if (offscreen) particles[i] = spawn(look, width, height, false);
        draw(ctx, look, p, p.x + Math.sin(p.phase) * look.sway);
      }
      frame = requestAnimationFrame(step);
    };

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(step);
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [effect, reduced]);

  if (reduced) return null;
  return <canvas ref={canvas} aria-hidden data-season={effect} className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />;
}
