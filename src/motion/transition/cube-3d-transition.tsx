'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #124 The two pages as two faces of a cube: the cube turns a quarter, carrying the first page away round its edge and
 * bringing the next into view, the far face darkening as it turns from the light. It turns with the reading direction.
 */
export default function Cube3dTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const sign = dir === 'rtl' ? 1 : -1;
  const turn = useTransform(progress, (p) => `translateZ(-50cqw) rotateY(${sign * 90 * easeInOutCubic(p)}deg)`);
  const shadeA = useTransform(progress, [0, 1], [0, 0.6]);
  const shadeB = useTransform(progress, [0, 1], [0.6, 0]);
  const face = { position: 'absolute' as const, inset: 0, backfaceVisibility: 'hidden' as const };
  return (
    <DomStage playing={playing} speed={speed} background="#0b0908" style={{ perspective: '140cqw' }}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: turn }}>
        <div style={{ ...face, transform: 'translateZ(50cqw)' }}>
          <PageA background={str(params, 'background')} />
          <motion.div style={{ position: 'absolute', inset: 0, background: '#000', opacity: shadeA }} />
        </div>
        <div style={{ ...face, transform: `rotateY(${-sign * 90}deg) translateZ(50cqw)` }}>
          <PageB background={str(params, 'accent')} />
          <motion.div style={{ position: 'absolute', inset: 0, background: '#000', opacity: shadeB }} />
        </div>
      </motion.div>
    </DomStage>
  );
}
