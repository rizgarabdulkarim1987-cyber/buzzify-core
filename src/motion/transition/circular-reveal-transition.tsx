'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #127 The next page grows out of the thing that was pressed: a circle opens from the button in the corner until it
 * covers the screen, so the guest sees where the new page came from.
 */
export default function CircularRevealTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const x = dir === 'rtl' ? 14 : 86;
  const y = 84;
  const clip = useTransform(progress, (p) => `circle(${easeInOutCubic(p) * 150}% at ${x}% ${y}%)`);
  const button = useTransform(progress, [0, 0.15], [1, 0]);
  const accent = str(params, 'accent');
  return (
    <DomStage playing={playing} speed={speed}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <PageA background={str(params, 'background')} />
      <motion.span style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: '11cqmin', height: '11cqmin', margin: '-5.5cqmin 0 0 -5.5cqmin', borderRadius: '50%', background: accent, boxShadow: '0 1.6cqmin 3cqmin -1cqmin rgb(0 0 0 / 0.45)', opacity: button }} />
      <motion.div style={{ position: 'absolute', inset: 0, clipPath: clip }}>
        <PageB background={accent} />
      </motion.div>
    </DomStage>
  );
}
