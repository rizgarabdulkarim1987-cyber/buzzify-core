'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { onTick } from './ticker';

/** A layout effect in the browser, nothing on the server. */
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** A ref that always holds the latest value, for callbacks a frame loop reads. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export interface LoopOptions {
  playing: boolean;
  speed: number;
  /** A change starts the motion again from 0. */
  replay?: number;
  /** The moment, in seconds, a still motion shows. */
  still?: number;
}

/**
 * Calls `render(t, dt)` every frame while playing, with `t` the motion's own seconds (scaled by `speed`). While still it
 * renders once, at `still` seconds when the motion has not run yet, and again whenever `render` changes (new
 * parameters), so a paused motion follows its controls. DOM motions write styles to refs from `render`; nothing
 * re-renders React per frame.
 */
export function useLoop(render: (t: number, dt: number) => void, { playing, speed, replay = 0, still = 1.5 }: LoopOptions): void {
  const renderRef = useLatest(render);
  const speedRef = useLatest(speed);
  const time = useRef(0);
  const started = useRef(false);

  useIsoLayoutEffect(() => {
    time.current = 0;
    started.current = false;
  }, [replay]);

  useEffect(() => {
    if (!playing) return;
    started.current = true;
    return onTick((dt) => {
      const step = dt * speedRef.current;
      time.current += step;
      renderRef.current(time.current, step);
    });
  }, [playing, replay, renderRef, speedRef]);

  // While still: draw the still moment (or where the viewer paused), again after every render with new values.
  useIsoLayoutEffect(() => {
    if (playing) return;
    if (!started.current && time.current === 0) time.current = still;
    renderRef.current(time.current, 0);
  });
}

/**
 * The index of the current step of a repeating sequence of `durations` (seconds), for interface demos that act out a
 * scene: tap, wait, confirm, reset. Re-renders only when the step changes.
 */
export function useSequence(durations: readonly number[], options: LoopOptions): number {
  const [index, setIndex] = useState(0);
  const current = useRef(0);
  const total = durations.reduce((sum, d) => sum + d, 0);
  useLoop(
    (t) => {
      let local = t % total;
      let next = 0;
      while (next < durations.length - 1 && local >= durations[next]!) {
        local -= durations[next]!;
        next += 1;
      }
      if (next !== current.current) {
        current.current = next;
        setIndex(next);
      }
    },
    { ...options, still: options.still ?? 0 },
  );
  return index;
}

/** Where a pointer is over an element, in pixels from its top-left corner, and whether it is there at all. */
export interface PointerState {
  x: number;
  y: number;
  inside: boolean;
  down: boolean;
}

/** The pointer over an element, kept in a ref for frame loops to read. */
export function usePointer(ref: RefObject<HTMLElement | null>, onDown?: (x: number, y: number) => void): RefObject<PointerState> {
  const state = useRef<PointerState>({ x: 0, y: 0, inside: false, down: false });
  const downRef = useLatest(onDown);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      state.current.x = event.clientX - box.left;
      state.current.y = event.clientY - box.top;
    };
    const move = (event: PointerEvent) => {
      place(event);
      state.current.inside = true;
    };
    const leave = () => {
      if (!state.current.down) state.current.inside = false;
    };
    const down = (event: PointerEvent) => {
      place(event);
      state.current.inside = true;
      state.current.down = true;
      downRef.current?.(state.current.x, state.current.y);
    };
    const up = (event: PointerEvent) => {
      state.current.down = false;
      const box = element.getBoundingClientRect();
      const out = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      if (out) state.current.inside = false;
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerenter', move);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerenter', move);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [ref, downRef]);
  return state;
}

/**
 * A synthetic pointer, from 0 to 1 across and down, drifting in a slow figure: what a pointer motion shows when nobody
 * points at it (a gallery card, a menu on a phone). `seed` moves the figure so neighbours do not move in step.
 */
export function ghost(t: number, seed = 0): [number, number] {
  return [0.5 + 0.3 * Math.sin(t * 0.8 + seed), 0.5 + 0.22 * Math.sin(t * 1.13 + 1.7 + seed * 1.3)];
}
