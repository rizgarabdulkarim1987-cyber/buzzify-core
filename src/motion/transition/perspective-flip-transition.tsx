'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #133 The page turned over like a card on the table: it lifts toward the viewer as it rotates on its vertical axis,
 * the light catching it as it passes edge-on, and lands showing its other side, the next page.
 */
export default function PerspectiveFlipTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const sign = dir === 'rtl' ? -1 : 1;
  const k = useTransform(progress, (p) => easeInOutCubic(p));
  const turn = useTransform(k, (v) => `rotateY(${sign * v * 180}deg) scale(${1 - Math.sin(v * Math.PI) * 0.12})`);
  const glint = useTransform(k, (v) => Math.max(0, 1 - Math.abs(v - 0.5) * 4) * 0.5);
  const face = { position: 'absolute' as const, inset: 0, backfaceVisibility: 'hidden' as const, borderRadius: '2cqmin', overflow: 'hidden' };
  return (
    <DomStage playing={playing} speed={speed} background="#0b0908" style={{ perspective: '160cqw' }}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: '4cqh 5cqw', transformStyle: 'preserve-3d', transform: turn }}>
        <div style={face}>
          <PageA background={str(params, 'background')} />
        </div>
        <div style={{ ...face, transform: 'rotateY(180deg)' }}>
          <PageB background={str(params, 'accent')} />
        </div>
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 30%, rgb(255 255 255 / 0.5), transparent 70%)', opacity: glint, pointerEvents: 'none' }} />
    </DomStage>
  );
}
