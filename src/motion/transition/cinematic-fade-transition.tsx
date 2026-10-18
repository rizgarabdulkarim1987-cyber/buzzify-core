'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #121 The film editor's dissolve through black: the first page darkens and drifts a little closer, the screen is
 * black for a breath, and the next page comes up out of the dark settling from a slight scale.
 */
export default function CinematicFadeTransition({ params, playing, speed, progress }: MotionProps) {
  const a = useTransform(progress, [0, 0.45], [1, 0]);
  const aScale = useTransform(progress, [0, 0.5], [1, 1.04]);
  const b = useTransform(progress, [0.55, 1], [0, 1]);
  const bScale = useTransform(progress, [0.5, 1], [1.04, 1]);
  return (
    <DomStage playing={playing} speed={speed} background="#000000">
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, opacity: a, scale: aScale }}>
        <PageA background={str(params, 'background')} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, opacity: b, scale: bScale }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
    </DomStage>
  );
}
