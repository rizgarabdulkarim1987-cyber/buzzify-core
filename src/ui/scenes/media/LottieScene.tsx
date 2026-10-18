'use client';

import type { AnimationItem } from 'lottie-web';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { SceneMedia } from '@/lib/templates/types';
import type { SceneSignal } from '../signal';

type Lottie = Extract<SceneMedia, { kind: 'lottie' }>;

/**
 * A business's Lottie animation as the menu's background (spec 2026-10-18-template-studio-stage-2-scene-files-design.md,
 * 5), drawn by lottie-web's light build, which has no expression engine: the file was checked to hold none, and could
 * not run one anyway. It covers the screen and loops while ambient movement is on; with ambient off and scroll on, its
 * frame follows the page's scroll both ways; with both off it holds still. A file that does not load or draw hands the
 * menu back to the template's motion background.
 */
export function LottieScene({
  media,
  signal,
  paused,
  ambient,
  scroll,
  speed,
  onReady,
  onFail,
}: {
  media: Lottie;
  signal: RefObject<SceneSignal>;
  paused: boolean;
  ambient: boolean;
  scroll: boolean;
  speed: number;
  onReady: () => void;
  onFail: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [animation, setAnimation] = useState<AnimationItem | null>(null);

  // Load once per file: the player (its own chunk) and the animation's data.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let active = true;
    let item: AnimationItem | null = null;
    Promise.all([import('lottie-web/build/player/lottie_light'), fetch(media.url, { credentials: 'omit' }).then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))])
      .then(([{ default: lottie }, animationData]: [{ default: typeof import('lottie-web').default }, unknown]) => {
        if (!active) return;
        item = lottie.loadAnimation({
          container: element,
          renderer: 'svg',
          loop: true,
          autoplay: false,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid slice', progressiveLoad: false, hideOnTransparent: true },
        });
        item.addEventListener('data_failed', onFail);
        item.addEventListener('error', onFail);
        item.addEventListener('DOMLoaded', () => {
          if (active) onReady();
        });
        setAnimation(item);
      })
      .catch(() => {
        if (active) onFail();
      });
    return () => {
      active = false;
      item?.destroy();
    };
  }, [media.url, onFail, onReady]);

  // Ambient: loop at the business's speed, holding still while paused.
  useEffect(() => {
    if (!animation) return;
    animation.setSpeed(speed);
    if (ambient && !paused) animation.play();
    else animation.pause();
  }, [animation, ambient, paused, speed]);

  // Ambient off and scroll on: the frame follows scroll progress, both ways.
  useEffect(() => {
    if (!animation || ambient || !scroll || paused) return;
    let frame = 0;
    let shown = -1;
    const tick = () => {
      const progress = signal.current.progress;
      if (progress !== shown) {
        shown = progress;
        animation.goToAndStop(progress * Math.max(0, animation.totalFrames - 1), true);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation, ambient, scroll, paused, signal]);

  return <div ref={container} className="scene-file scene-file-fill" data-file="lottie" />;
}
