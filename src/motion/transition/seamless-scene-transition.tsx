'use client';

import { motion, useTransform } from 'motion/react';
import { inkOn } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { easeInOutCubic, lerp } from '../engine/math';
import { DishCutout, MENU_CSS, SAMPLE_MENU, TextBar } from '../engine/menu';
import { str, type MotionProps } from '../types';

/**
 * #134 One scene flowing into the next with nothing cut: the room's colour turns, the dish glides from the middle of
 * the first scene to its place at the side of the second, growing as it goes, and each scene's words fade on either
 * side of it. The dish never leaves the screen, so the eye has something to hold.
 */
export default function SeamlessSceneTransition({ params, playing, speed, progress, dir }: MotionProps) {
  const a = str(params, 'background');
  const b = str(params, 'accent');
  const inkA = inkOn(a);
  const inkB = inkOn(b);
  const k = useTransform(progress, (p) => easeInOutCubic(p));
  const ground = useTransform(progress, [0, 1], [a, b]);
  const side = dir === 'rtl' ? -1 : 1;
  const x = useTransform(k, (v) => `${lerp(0, side * 22, v)}cqw`);
  const y = useTransform(k, (v) => `${lerp(6, -2, v)}cqh`);
  const scale = useTransform(k, [0, 1], [0.8, 1.15]);
  const rotate = useTransform(k, [0, 1], [-8, 6]);
  const firstWords = useTransform(k, [0, 0.4], [1, 0]);
  const firstY = useTransform(k, [0, 0.4], ['0cqh', '-4cqh']);
  const nextWords = useTransform(k, [0.6, 1], [0, 1]);
  const nextY = useTransform(k, [0.6, 1], ['4cqh', '0cqh']);
  return (
    <DomStage playing={playing} speed={speed}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', inset: 0, background: ground }} />
      <motion.div style={{ position: 'absolute', top: '10cqh', insetInline: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.8cqmin', opacity: firstWords, y: firstY }}>
        <TextBar width="36cqw" height="3cqmin" color={inkA} />
        <TextBar width="22cqw" height="1.4cqmin" color={inkA} style={{ opacity: 0.4 }} />
      </motion.div>
      <motion.div style={{ position: 'absolute', top: '30cqh', insetInlineStart: '8cqw', width: '38cqw', display: 'flex', flexDirection: 'column', gap: '2cqmin', opacity: nextWords, y: nextY }}>
        <TextBar width="90%" height="3.4cqmin" color={inkB} />
        <TextBar width="100%" height="1.4cqmin" color={inkB} style={{ opacity: 0.35 }} />
        <TextBar width="80%" height="1.4cqmin" color={inkB} style={{ opacity: 0.35 }} />
        <TextBar width="40%" height="5cqmin" color="#f2b705" style={{ marginTop: '2cqmin' }} />
      </motion.div>
      <motion.div style={{ position: 'absolute', left: '50%', top: '50%', width: '48cqmin', height: '48cqmin', margin: '-24cqmin 0 0 -24cqmin', x, y, scale, rotate }}>
        <DishCutout dish={SAMPLE_MENU[2]!} />
      </motion.div>
    </DomStage>
  );
}
