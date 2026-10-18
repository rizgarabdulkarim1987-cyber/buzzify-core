'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #131 A soft cross-dissolve: the first page goes out of focus as it fades and the next comes into focus as it
 * appears, so for a moment the two are one blurred, mixed image.
 */
export default function BlurDissolveTransition({ params, playing, speed, progress }: MotionProps) {
  const aOpacity = useTransform(progress, [0.15, 0.75], [1, 0]);
  const aBlur = useTransform(progress, [0, 0.6], ['blur(0cqmin)', 'blur(2cqmin)']);
  const bOpacity = useTransform(progress, [0.25, 0.85], [0, 1]);
  const bBlur = useTransform(progress, [0.4, 1], ['blur(2cqmin)', 'blur(0cqmin)']);
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'accent')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, opacity: bOpacity, filter: bBlur }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, opacity: aOpacity, filter: aBlur }}>
        <PageA background={str(params, 'background')} />
      </motion.div>
    </DomStage>
  );
}
