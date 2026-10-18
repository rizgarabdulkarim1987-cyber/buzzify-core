'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #132 A camera pushing through the page: the first page rushes at the lens, smearing with motion blur and flaring
 * white, and the next page settles in behind the flash, pulling back to rest.
 */
export default function CameraPushTransition({ params, playing, speed, progress }: MotionProps) {
  const aScale = useTransform(progress, [0, 0.5], [1, 1.7]);
  const aBlur = useTransform(progress, [0, 0.5], ['blur(0cqmin)', 'blur(1.6cqmin)']);
  const aOpacity = useTransform(progress, [0.3, 0.5], [1, 0]);
  const flash = useTransform(progress, [0.35, 0.5, 0.68], [0, 0.85, 0]);
  const bScale = useTransform(progress, [0.45, 1], [1.25, 1]);
  const bBlur = useTransform(progress, [0.45, 0.85], ['blur(1.2cqmin)', 'blur(0cqmin)']);
  const bOpacity = useTransform(progress, [0.45, 0.6], [0, 1]);
  return (
    <DomStage playing={playing} speed={speed} background="#000000">
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, scale: bScale, filter: bBlur, opacity: bOpacity }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, scale: aScale, filter: aBlur, opacity: aOpacity }}>
        <PageA background={str(params, 'background')} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle, #ffffff, rgb(255 255 255 / 0.6) 60%, rgb(255 255 255 / 0.2))', opacity: flash, pointerEvents: 'none' }} />
    </DomStage>
  );
}
