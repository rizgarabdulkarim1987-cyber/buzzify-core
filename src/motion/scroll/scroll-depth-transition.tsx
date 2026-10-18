'use client';

import { motion, useTransform, type MotionValue } from 'motion/react';
import { DomStage, MotionStyle } from '../engine/dom';
import { dishAt, DishPicture, MENU_CSS } from '../engine/menu';
import { clamp } from '../engine/math';
import { num, str, type MotionProps } from '../types';

/** How far apart the cards hang in depth, in CSS pixels at `depth` 1, for a 600 px perspective. */
const GAP = 380;

function Card({ index, count, depth, progress }: { index: number; count: number; depth: number; progress: MotionValue<number> }) {
  const gap = GAP * depth;
  const z = useTransform(progress, (p) => -index * gap + p * (count - 0.6) * gap);
  // Fade in from the haze, and out as a card comes too close.
  const opacity = useTransform(z, (d) => clamp((d + count * gap) / (gap * 1.5)) * clamp(1 - (d - 120) / 260));
  const side = index % 2 === 0 ? -1 : 1;
  return (
    <motion.div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '34cqmin',
        height: '44cqmin',
        margin: '-22cqmin 0 0 -17cqmin',
        x: `${side * 16}cqw`,
        z,
        opacity,
        rotateY: side * -8,
        borderRadius: '2.4cqmin',
        overflow: 'hidden',
        boxShadow: '0 4cqmin 8cqmin -4cqmin rgb(0 0 0 / 0.7)',
      }}
    >
      <DishPicture dish={dishAt(index)} />
    </motion.div>
  );
}

/** #23 Cards hung one behind another in the dark: the scroll carries them toward the viewer, and past. */
export default function ScrollDepthTransition({ params, playing, speed, progress }: MotionProps) {
  const count = num(params, 'count');
  const depth = num(params, 'depth');
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')} style={{ perspective: '600px' }}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}>
        {Array.from({ length: count }, (_, i) => count - 1 - i).map((i) => (
          <Card key={i} index={i} count={count} depth={depth} progress={progress} />
        ))}
      </div>
    </DomStage>
  );
}
