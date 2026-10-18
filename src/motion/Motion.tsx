'use client';

import { Component, createElement, lazy, Suspense, useMemo, useRef, type ComponentType, type CSSProperties, type LazyExoticComponent, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';
import { motionById } from './catalog';
import type { RunnerProps } from './engine/runner';
import { useVisible } from './engine/visible';
import { MOTION_LOADERS } from './loaders';
import type { MotionValue } from './motion-value';
import { resolveParams } from './params';
import type { MotionParams } from './types';

export interface MotionComponentProps {
  /** A motion's id from the catalog, such as `golden-particles`. */
  id: string;
  /** Any of the motion's parameters; the rest take their defaults, and invalid values are replaced. */
  params?: Partial<MotionParams>;
  /** False holds a still frame. Default true. */
  playing?: boolean;
  speed?: number;
  /**
   * The progress a progress motion draws (0 to 1), such as `useScroll().scrollYProgress`. Without one, a progress motion
   * plays forward and back on its own.
   */
  progress?: MotionValue<number>;
  /** Change it to play the motion again from its start. */
  replay?: number;
  dir?: 'ltr' | 'rtl';
  /** Show a still frame to people who ask for reduced motion. Default true; the Studio's own switch turns it off. */
  respectReducedMotion?: boolean;
  /** Pause while off screen. Default true. */
  pauseOffscreen?: boolean;
  className?: string;
  style?: CSSProperties;
}

const lazies = new Map<string, LazyExoticComponent<ComponentType<RunnerProps>>>();

/**
 * A motion's code and its runner, loaded together on first use. This entry imports neither, so a menu that places a
 * motion ships only this file until the motion is on screen.
 */
function lazyMotion(id: string): LazyExoticComponent<ComponentType<RunnerProps>> | null {
  const loader = MOTION_LOADERS[id];
  const meta = motionById(id);
  if (!loader || !meta) return null;
  let found = lazies.get(id);
  if (!found) {
    found = lazy(async () => {
      const [{ runner }, motion] = await Promise.all([import('./engine/runner'), loader()]);
      return { default: runner(motion.default, meta.drive) };
    });
    lazies.set(id, found);
  }
  return found;
}

/** Starts loading a motion's code ahead of showing it (a card about to scroll into view). */
export function preloadMotion(id: string): void {
  void MOTION_LOADERS[id]?.();
}

/** The colour among a motion's parameters that reads as its background, for its loading and failure frames. */
function stillBackground(params: MotionParams): string {
  const value = params.background ?? params.color;
  return typeof value === 'string' ? value : '#0d0b09';
}

class MotionBoundary extends Component<{ fallback: ReactNode; children: ReactNode; id: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(`Motion "${this.props.id}" failed`, error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * A motion from the library, by id. Its code loads on demand; it fills its parent (give the parent a size), pauses off
 * screen, and shows a still frame under reduced motion. A motion that fails shows its background, not an error page.
 *
 * ```tsx
 * <div style={{ height: 320 }}><Motion id="golden-particles" params={{ count: 200 }} /></div>
 * ```
 */
export function Motion({
  id,
  params,
  playing = true,
  speed = 1,
  progress,
  replay = 0,
  dir = 'ltr',
  respectReducedMotion = true,
  pauseOffscreen = true,
  className,
  style,
}: MotionComponentProps) {
  const meta = motionById(id);
  const host = useRef<HTMLDivElement>(null);
  const visible = useVisible(host);
  const reduced = usePrefersReducedMotion();
  const key = JSON.stringify(params ?? {});
  // `key` stands for `params`: a new object with the same values keeps the resolved parameters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolved = useMemo(() => (meta ? resolveParams(meta, params) : {}), [meta, key]);
  const live = playing && (!pauseOffscreen || visible) && !(respectReducedMotion && reduced);
  const Loaded = lazyMotion(id);
  if (!meta || !Loaded) return null;

  // Shown while the motion's code loads, and in its place if it fails: its own background, marked for tests to wait on.
  const fallback = <div aria-hidden data-loading="" style={{ position: 'absolute', inset: 0, background: stillBackground(resolved) }} />;
  return (
    <div
      ref={host}
      className={className}
      data-motion={id}
      data-playing={live ? 'true' : 'false'}
      dir={dir}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', isolation: 'isolate', ...style }}
    >
      <MotionBoundary id={id} fallback={fallback}>
        <Suspense fallback={fallback}>
          {/* The lazy component is cached per id (lazyMotion), so it is the same component on every render. */}
          {createElement(Loaded, { params: resolved, playing: live, speed, replay, dir, ...(progress ? { progress } : {}) })}
        </Suspense>
      </MotionBoundary>
    </div>
  );
}
