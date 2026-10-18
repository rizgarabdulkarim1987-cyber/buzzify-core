'use client';

import dynamic from 'next/dynamic';
import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { qualifiesFor3D } from '@/lib/stage';
import type { MenuDesign } from '@/lib/templates/types';
import { probeEnvironment } from '@/ui/stage/device';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';
import { ScenePoster } from './posters';
import { createSceneSignal, effectiveMode, isInteractiveTarget, scrollProgress, type SceneEnvironment } from './signal';
import './scenes.css';

// three.js and the preset's scene load only when this device will draw them, never with the menu's first JavaScript.
const SceneCanvas = dynamic(() => import('./three/SceneCanvas'), { ssr: false });

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const noSubscription = () => () => {};
// `?scene=fail` makes the 3D scene throw, to see (and test) the fallback on a device that can run it.
const readForcedFailure = () => new URLSearchParams(window.location.search).get('scene') === 'fail';
const noForcedFailure = () => false;

/**
 * A template menu's background (spec 6): the preset's static poster, painted with the page; its motion version once the
 * page is interactive; and its real 3D scene on a device that qualifies, loaded after the page is idle. Each step down
 * is the fallback for the one above. The layer never takes a pointer event or the page's scroll: taps reach it from a
 * passive listener that ignores every control, and only when the business left the tap reaction on.
 */
export function SceneLayer({ design, paused, categoryIndex }: { design: MenuDesign; paused: boolean; categoryIndex: number }) {
  const { scene } = design;
  const reduced = usePrefersReducedMotion();
  const layer = useRef<HTMLDivElement>(null);
  // Written by the page (scroll, taps, pointer, pause, category) and read by the 3D clock every frame; never rendered.
  const signal = useRef(createSceneSignal());
  const [env, setEnv] = useState<SceneEnvironment | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const forceFailure = useSyncExternalStore(noSubscription, readForcedFailure, noForcedFailure);

  // Judge the device once the page has settled: the probe opens a WebGL context, which is not free.
  useEffect(() => {
    if (scene.mode !== '3d') return;
    const run = () => {
      const probe = probeEnvironment();
      setEnv({ reducedMotion: false, qualifies3d: qualifiesFor3D(probe), saveData: probe.saveData });
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1200);
    return () => clearTimeout(id);
  }, [scene.mode]);

  const mode =
    scene.mode === '3d' && (failed || env === null)
      ? effectiveMode('motion', { reducedMotion: reduced, qualifies3d: false, saveData: env?.saveData ?? false })
      : effectiveMode(scene.mode, { reducedMotion: reduced, qualifies3d: env?.qualifies3d ?? false, saveData: env?.saveData ?? false });
  const moving = mode !== 'static';

  const fail = useCallback(() => {
    setFailed(true);
    setReady(false);
  }, []);

  // Scroll progress, both ways, as a number for the 3D scene and a CSS variable for the motion layer.
  useEffect(() => {
    const element = layer.current;
    const shared = signal.current;
    if (!moving || !scene.scroll || !element) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      shared.progress = scrollProgress(window.scrollY, document.documentElement.scrollHeight, window.innerHeight);
      element.style.setProperty('--scene-progress', shared.progress.toFixed(4));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
      element.style.removeProperty('--scene-progress');
      shared.progress = 0;
    };
  }, [moving, scene.scroll, signal]);

  // A tap on the background (never on a control) answers where it landed.
  useEffect(() => {
    const element = layer.current;
    if (!moving || !scene.tap || !element) return;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    const onDown = (event: PointerEvent) => {
      if (!event.isPrimary || isInteractiveTarget(event.target as Element | null)) return;
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = -((event.clientY / window.innerHeight) * 2 - 1);
      signal.current.tap = { x, y, time: performance.now() };
      if (mode === 'motion') {
        // A short-lived mark the motion layer reacts to (stones tilt, shapes bounce), and a ripple where the tap landed.
        element.setAttribute('data-tapped', '');
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => element.removeAttribute('data-tapped'), 650);
        const ripple = document.createElement('span');
        ripple.className = 'scene-ripple';
        ripple.style.left = `${event.clientX}px`;
        ripple.style.top = `${event.clientY}px`;
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        element.appendChild(ripple);
      }
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      clearTimeout(tapTimer);
    };
  }, [moving, scene.tap, mode, signal]);

  // A fine pointer leans the scene a little (desktop parallax); touch screens never depend on it.
  useEffect(() => {
    const element = layer.current;
    if (!moving || !element || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    let next = { x: 0, y: 0 };
    const apply = () => {
      frame = 0;
      signal.current.pointer = next;
      element.style.setProperty('--px', next.x.toFixed(3));
      element.style.setProperty('--py', next.y.toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      next = { x: (event.clientX / window.innerWidth) * 2 - 1, y: -((event.clientY / window.innerHeight) * 2 - 1) };
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [moving, signal]);

  // Held still while the page is hidden, a product covers it, or the guest paused it.
  useEffect(() => {
    const update = () => {
      signal.current.paused = paused || document.hidden;
      layer.current?.toggleAttribute('data-paused', signal.current.paused);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [paused, signal]);

  useEffect(() => {
    if (signal.current.category === categoryIndex) return;
    signal.current.category = categoryIndex;
    signal.current.categoryTime = performance.now();
  }, [categoryIndex, signal]);

  const style = {
    '--scene-intensity': String(scene.intensity),
    '--scene-speed': String(scene.speed),
    // The category moves the scene only when it moves at all.
    '--scene-category': moving ? String(categoryIndex) : '0',
    opacity: scene.opacity,
    filter: [scene.brightness !== 1 ? `brightness(${scene.brightness})` : '', scene.blur > 0 ? `blur(${scene.blur}px)` : ''].join(' ').trim() || undefined,
  } as CSSProperties;

  return (
    <div
      ref={layer}
      aria-hidden
      className={`scene-layer scene-${mode} ${ready ? 'scene-ready' : ''}`}
      data-scene={design.templateId}
      data-mode={mode}
      data-ambient={moving && scene.ambient ? '' : undefined}
      style={style}
    >
      <ScenePoster id={design.templateId} palette={design.palette} />
      {mode === '3d' && (
        <SceneBoundary onError={fail}>
          <SceneCanvas design={design} signal={signal} paused={paused} forceFailure={forceFailure} onReady={() => setReady(true)} onFail={fail} />
        </SceneBoundary>
      )}
      <div className="scene-veil" style={{ opacity: scene.overlay }} />
    </div>
  );
}
