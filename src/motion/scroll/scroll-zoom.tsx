'use client';

import { motion, useTransform, type MotionValue } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { dishAt, DishPicture, MENU_CSS } from '../engine/menu';
import { easeInOutCubic } from '../engine/math';
import { str, type MotionProps } from '../types';

/** The eight cards around the centre: their place in the 3 × 3 grid. */
const RING = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

function Neighbour({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const [cx, cy] = RING[index]!;
  const out = useTransform(progress, (p) => easeInOutCubic(p));
  const x = useTransform(out, (o) => `${cx * (31 + o * 40)}cqw`);
  const y = useTransform(out, (o) => `${cy * (33 + o * 40)}cqh`);
  const opacity = useTransform(out, [0, 0.8], [1, 0]);
  return (
    <motion.div
      style={{ position: 'absolute', left: '50%', top: '50%', width: '28cqw', height: '30cqh', margin: '-15cqh 0 0 -14cqw', x, y, opacity, borderRadius: '2cqmin', overflow: 'hidden' }}
    >
      <DishPicture dish={dishAt(index + 1)} />
    </motion.div>
  );
}

/**
 * #22 A grid of dishes where the middle one grows with the scroll until it fills the frame, its corners straightening as
 * it goes, while the others are pushed out past the edges.
 */
export default function ScrollZoom({ params, playing, speed, progress }: MotionProps) {
  const grow = useTransform(progress, (p) => easeInOutCubic(p));
  const width = useTransform(grow, (g) => `${28 + g * 72}cqw`);
  const height = useTransform(grow, (g) => `${30 + g * 70}cqh`);
  const radius = useTransform(grow, (g) => `${2 * (1 - g)}cqmin`);
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      {RING.map((_, i) => (
        <Neighbour key={i} index={i} progress={progress} />
      ))}
      <motion.div style={{ position: 'absolute', left: '50%', top: '50%', width, height, x: '-50%', y: '-50%', borderRadius: radius, overflow: 'hidden', boxShadow: `0 0 0 1px ${str(params, 'accent')}22` }}>
        <DishPicture dish={dishAt(0)} />
      </motion.div>
    </DomStage>
  );
}
