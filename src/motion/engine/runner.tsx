'use client';

import { useMotionValue, type MotionValue } from 'motion/react';
import { useEffect, useRef, type ComponentType } from 'react';
import { pingPong } from '../progress';
import type { MotionDrive, MotionProps } from '../types';
import { onTick } from './ticker';

/** A still progress motion rests most of the way through, where it shows what it does. */
const STILL_PROGRESS = 0.62;

/** The forward-and-back progress a progress motion plays when nothing else owns it. */
function useAutoProgress(active: boolean, playing: boolean, speed: number, replay: number): MotionValue<number> {
  const progress = useMotionValue(STILL_PROGRESS);
  const time = useRef(0);
  const speedRef = useRef(speed);
  const playingRef = useRef(playing);
  useEffect(() => {
    speedRef.current = speed;
    playingRef.current = playing;
  }, [speed, playing]);
  useEffect(() => {
    time.current = 0;
    if (active) progress.set(playingRef.current ? 0 : STILL_PROGRESS);
  }, [replay, active, progress]);
  useEffect(() => {
    if (!active || !playing) return;
    return onTick((dt) => {
      time.current += dt * speedRef.current;
      progress.set(pingPong(time.current, 2.6, 0.9));
    });
  }, [active, playing, progress]);
  return progress;
}

export type RunnerProps = Omit<MotionProps, 'progress'> & { progress?: MotionValue<number> };

/**
 * Runs a loaded motion: gives a progress motion its own forward-and-back progress when the page passes none. Loaded
 * with the motion's code, so the `Motion` entry a menu imports carries none of the animation library.
 */
export function runner(Component: ComponentType<MotionProps>, drive: MotionDrive): ComponentType<RunnerProps> {
  function MotionRunner({ progress, ...props }: RunnerProps) {
    const auto = useAutoProgress(drive === 'progress' && !progress, props.playing, props.speed, props.replay);
    return <Component {...props} progress={progress ?? auto} />;
  }
  return MotionRunner;
}
