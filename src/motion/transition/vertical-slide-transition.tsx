'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #130 A sheet rising over the page: the next page slides up from the bottom edge with rounded top corners that square
 * off as it arrives, and the page under it sinks back a little and darkens.
 */
export default function VerticalSlideTransition({ params, playing, speed, progress }: MotionProps) {
  const k = useTransform(progress, (p) => easeInOutCubic(p));
  const bY = useTransform(k, (v) => `${(1 - v) * 100}%`);
  const radius = useTransform(k, (v) => `${(1 - v) * 4}cqmin ${(1 - v) * 4}cqmin 0 0`);
  const aScale = useTransform(k, [0, 1], [1, 0.94]);
  const dim = useTransform(k, [0, 1], [0, 0.5]);
  return (
    <DomStage playing={playing} speed={speed} background="#000000">
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, scale: aScale, borderRadius: '2cqmin', overflow: 'hidden' }}>
        <PageA background={str(params, 'background')} />
        <motion.div style={{ position: 'absolute', inset: 0, background: '#000', opacity: dim }} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, y: bY, borderRadius: radius, overflow: 'hidden' }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
    </DomStage>
  );
}
