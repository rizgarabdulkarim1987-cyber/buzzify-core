'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { Color } from 'three';
import type { DesignPalette, SceneSettings } from '@/lib/templates/types';
import type { SceneSignal } from '../../signal';

/**
 * The scene clock every 3D scene reads in its frame loop, updated once per frame before any scene runs:
 * - `t`: seconds of ambient time, scaled by the business's speed; it stands still when ambient movement is off;
 * - `progress`: scroll progress eased toward the page's (0 when scroll is off), so scrubbing reverses smoothly;
 * - `tap`: the last background tap in world units at z = 0, and `tapPulse` from 1 (just tapped) falling to 0;
 * - `category` and `categoryPulse`: the category in view, and 1 just after it changed, falling to 0;
 * - `pointer`: a fine pointer's lean, eased, in -1..1.
 */
export interface SceneClock {
  t: number;
  progress: number;
  tap: { x: number; y: number };
  tapPulse: number;
  tapCount: number;
  category: number;
  categoryPulse: number;
  pointer: { x: number; y: number };
  intensity: number;
  /** The visible width and height at z = 0, for placing things against the screen's edges. */
  width: number;
  height: number;
}

const ClockContext = createContext<SceneClock | null>(null);

export function useSceneClock(): SceneClock {
  const clock = useContext(ClockContext);
  if (!clock) throw new Error('useSceneClock must be used inside a scene');
  return clock;
}

const TAP_DECAY_MS = 900;
const CATEGORY_DECAY_MS = 1400;

export function ClockProvider({ signal, settings, children }: { signal: RefObject<SceneSignal>; settings: SceneSettings; children: ReactNode }) {
  // The clock lives as long as the canvas; settings are read every frame below.
  const [clock] = useState(() => createClock(settings.intensity));
  const viewport = useThree((state) => state.viewport);

  // Runs before the scenes' own frame callbacks (a lower priority runs first).
  useFrame((_, delta) => tickClock(clock, signal.current, settings, viewport, delta, performance.now()), -10);

  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

function createClock(intensity: number): SceneClock & { lastTap: number } {
  return { t: 0, progress: 0, tap: { x: 0, y: 0 }, tapPulse: 0, tapCount: 0, category: 0, categoryPulse: 0, pointer: { x: 0, y: 0 }, intensity, width: 1, height: 1, lastTap: -Infinity };
}

/** One frame of the clock: what the page wrote to the signal, eased into what the scenes read. */
function tickClock(
  clock: SceneClock & { lastTap: number },
  signal: SceneSignal,
  settings: SceneSettings,
  viewport: { width: number; height: number },
  delta: number,
  now: number,
): void {
  const dt = Math.min(delta, 1 / 20);
  clock.intensity = settings.intensity;
  clock.width = viewport.width;
  clock.height = viewport.height;
  if (settings.ambient && !signal.paused) clock.t += dt * settings.speed;
  const target = settings.scroll ? signal.progress : 0;
  clock.progress += (target - clock.progress) * (1 - Math.exp(-dt * 7));
  if (signal.tap && settings.tap) {
    if (signal.tap.time !== clock.lastTap) {
      clock.lastTap = signal.tap.time;
      clock.tapCount += 1;
      clock.tap = { x: (signal.tap.x * viewport.width) / 2, y: (signal.tap.y * viewport.height) / 2 };
    }
    clock.tapPulse = Math.max(0, 1 - (now - signal.tap.time) / TAP_DECAY_MS);
  } else clock.tapPulse = 0;
  clock.category = signal.category;
  clock.categoryPulse = Math.max(0, 1 - (now - signal.categoryTime) / CATEGORY_DECAY_MS);
  const ease = 1 - Math.exp(-dt * 3);
  clock.pointer.x += (signal.pointer.x - clock.pointer.x) * ease;
  clock.pointer.y += (signal.pointer.y - clock.pointer.y) * ease;
}

/** The template palette as three.js colours, built once per palette. */
export function usePaletteColors(palette: DesignPalette) {
  const colors = useMemo(
    () => ({
      bg: new Color(palette.bg),
      surface: new Color(palette.surface),
      raised: new Color(palette.raised),
      card: new Color(palette.card),
      text: new Color(palette.text),
      muted: new Color(palette.muted),
      line: new Color(palette.line),
      accent: new Color(palette.accent),
      button: new Color(palette.button),
    }),
    [palette],
  );
  return colors;
}

/** Eases `current` toward `target` at `rate` per second. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.min(dt, 1 / 20)));
}
