'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #126 The next page uncovered by a diagonal blade: a slanted edge sweeps from one corner to the other, revealing the
 * page beneath it. It sweeps with the reading direction.
 */
export default function MaskRevealTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const rtl = dir === 'rtl';
  const at = useTransform(progress, (p) => -40 + easeInOutCubic(p) * 180);
  const clip = useTransform(at, (x) => (rtl ? `polygon(${100 - x}% 0%, 100% 0%, 100% 100%, ${140 - x}% 100%)` : `polygon(0% 0%, ${x}% 0%, ${x - 40}% 100%, 0% 100%)`));
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
