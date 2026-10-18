'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #129 The platform's own push: the next page slides in from the end of the line while the current one moves a third
 * as far and dims, as if left behind underneath. In Arabic and Sorani it comes from the left.
 */
export default function HorizontalSlideTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const sign = dir === 'rtl' ? -1 : 1;
  const k = useTransform(progress, (p) => easeInOutCubic(p));
  const aX = useTransform(k, (v) => `${-sign * v * 30}%`);
  const bX = useTransform(k, (v) => `${sign * (1 - v) * 100}%`);
  const dim = useTransform(k, [0, 1], [0, 0.4]);
  return (
    <DomStage playing={playing} speed={speed} background="#000000">
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, x: aX }}>
        <PageA background={str(params, 'background')} />
        <motion.div style={{ position: 'absolute', inset: 0, background: '#000', opacity: dim }} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, x: bX, boxShadow: '0 0 6cqmin rgb(0 0 0 / 0.45)' }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
    </DomStage>
  );
}
