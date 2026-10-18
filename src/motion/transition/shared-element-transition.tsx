'use client';

import { motion, useTransform } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic, lerp } from '../engine/math';
import { dishAt, DishPicture, MENU_CSS } from '../engine/menu';
import { HERO, PageA, PageB, THUMB } from '../engine/pages';
import { str, type MotionProps } from '../types';

/**
 * #135 The picture carries the guest from the list to the dish: the first thumbnail lifts out of its row and grows, its
 * corners straightening, into the hero picture at the top of the dish's page, while the list fades away beneath it and
 * the page's details fade in. The same picture, never a cut.
 */
export default function SharedElementTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const rtl = dir === 'rtl';
  const k = useTransform(progress, (p) => easeInOutCubic(p));
  const thumbLeft = rtl ? 100 - THUMB.left - THUMB.width : THUMB.left;
  const left = useTransform(k, (v) => `${lerp(thumbLeft, HERO.left, v)}%`);
  const top = useTransform(k, (v) => `${lerp(THUMB.top, HERO.top, v)}%`);
  const width = useTransform(k, (v) => `${lerp(THUMB.width, HERO.width, v)}%`);
  const height = useTransform(k, (v) => `${lerp(THUMB.height, HERO.height, v)}%`);
  const radius = useTransform(k, (v) => `${lerp(1.8, 0, v)}cqmin`);
  const list = useTransform(k, [0, 0.5], [1, 0]);
  const page = useTransform(k, [0.45, 1], [0, 1]);
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'accent')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, opacity: page }}>
        <PageB background={str(params, 'accent')} hideHero />
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, opacity: list }}>
        <PageA background={str(params, 'background')} hideFirstThumb />
      </motion.div>
      <motion.div style={{ position: 'absolute', left, top, width, height, borderRadius: radius, overflow: 'hidden', boxShadow: '0 2cqmin 5cqmin -2cqmin rgb(0 0 0 / 0.45)' }}>
        <DishPicture dish={dishAt(0)} />
      </motion.div>
    </DomStage>
  );
}
