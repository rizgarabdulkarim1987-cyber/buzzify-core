'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #125 Moving through depth: the first page rushes toward the viewer and past, blurring and fading, as the next comes
 * forward out of the distance into focus.
 */
export default function DepthZoomTransition({ params, playing, speed, progress }: MotionProps) {
  const aScale = useTransform(progress, [0, 1], [1, 2.4]);
  const aOpacity = useTransform(progress, [0, 0.6], [1, 0]);
  const aBlur = useTransform(progress, [0, 0.6], ['blur(0cqmin)', 'blur(1.5cqmin)']);
  const bScale = useTransform(progress, [0.2, 1], [0.55, 1]);
  const bOpacity = useTransform(progress, [0.2, 0.7], [0, 1]);
  const bBlur = useTransform(progress, [0.2, 0.9], ['blur(1.2cqmin)', 'blur(0cqmin)']);
  return (
    <DomStage playing={playing} speed={speed} background="#000000">
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, scale: bScale, opacity: bOpacity, filter: bBlur }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, scale: aScale, opacity: aOpacity, filter: aBlur }}>
        <PageA background={str(params, 'background')} />
      </motion.div>
    </DomStage>
  );
}
