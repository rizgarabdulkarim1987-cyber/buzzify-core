'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic, lerp } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #123 A card that becomes a page: the next page first appears as a small rounded card over the first, then grows,
 * its corners straightening, until it is the whole screen, while the page beneath sinks back and dims.
 */
export default function MorphingPageTransition({ params, playing, speed, progress }: MotionProps) {
  const clip = useTransform(progress, (p) => {
    const k = easeInOutCubic(p);
    const x = lerp(30, 0, k);
    const y = lerp(28, 0, k);
    return `inset(${y}% ${x}% ${y}% ${x}% round ${lerp(4, 0, k)}cqmin)`;
  });
  const opacity = useTransform(progress, [0, 0.12], [0, 1]);
  const under = useTransform(progress, [0, 1], [1, 0.92]);
  const dim = useTransform(progress, [0, 1], [0, 0.55]);
  return (
    <DomStage playing={playing} speed={speed} background="#000000">
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, scale: under }}>
        <PageA background={str(params, 'background')} />
        <motion.div style={{ position: 'absolute', inset: 0, background: '#000', opacity: dim }} />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, clipPath: clip, opacity }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
    </DomStage>
  );
}
