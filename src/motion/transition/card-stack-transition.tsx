'use client';

import { motion, useTransform } from 'motion/react';
import { mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic } from '../engine/math';
import { MENU_CSS } from '../engine/menu';
import { PageA, PageB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #128 Pages as a stack of cards: the top card slides off and turns away, the card beneath rises to take its place, and
 * the edge of a third peeks from under the stack. It slides against the reading direction, like turning a page.
 */
export default function CardStackTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const sign = dir === 'rtl' ? 1 : -1;
  const out = useTransform(progress, (p) => easeInOutCubic(p));
  const x = useTransform(out, (k) => `${sign * k * 120}%`);
  const rotate = useTransform(out, (k) => sign * k * 10);
  const under = useTransform(out, (k) => 0.92 + k * 0.08);
  const underY = useTransform(out, (k) => `${(1 - k) * 4}cqh`);
  const card = { position: 'absolute' as const, inset: '6cqh 8cqw', borderRadius: '3cqmin', overflow: 'hidden', boxShadow: '0 3cqmin 6cqmin -3cqmin rgb(0 0 0 / 0.55)' };
  const background = str(params, 'background');
  return (
    <DomStage playing={playing} speed={speed} background={mix(background, '#000000', 0.55)}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={{ ...card, transform: 'translateY(8cqh) scale(0.84)', background: mix(background, '#ffffff', 0.4) }} />
      <motion.div style={{ ...card, scale: under, y: underY }}>
        <PageB background={str(params, 'accent')} />
      </motion.div>
      <motion.div style={{ ...card, x, rotate }}>
        <PageA background={background} />
      </motion.div>
    </DomStage>
  );
}
