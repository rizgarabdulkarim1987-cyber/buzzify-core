'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

const STEPS = 28;

/** A clip polygon whose edge is a wave standing at `edge` percent across, swelling most in the middle of the wipe. */
function wave(edge: number, swell: number, rtl: boolean): string {
  const points: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const y = (i / STEPS) * 100;
    const x = edge + Math.sin((i / STEPS) * Math.PI * 3 + edge * 0.08) * swell;
    points.push(`${rtl ? 100 - x : x}% ${y}%`);
  }
  return rtl ? `polygon(100% 0%, ${points.join(', ')}, 100% 100%)` : `polygon(0% 0%, ${points.join(', ')}, 0% 100%)`;
}

/**
 * #122 The next page pours over the first: its edge is a moving wave rather than a straight line, swelling as it crosses
 * the middle and flattening as it reaches the far side. It runs with the reading direction.
 */
export default function LiquidWipeTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const clip = useTransform(progress, (p) => {
    const k = easeInOutCubic(p);
    return wave(-12 + k * 124, 6 * Math.sin(Math.PI * k), dir === 'rtl');
  });
  return (
    <DomStage playing={playing} speed={speed}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <PageA background={str(params, 'background')} />
      <motion.div style={{ position: 'absolute', inset: 0, clipPath: clip }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
    </DomStage>
  );
}
