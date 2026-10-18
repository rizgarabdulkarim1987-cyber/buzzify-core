'use client';

import { motion, useTransform } from 'motion/react';
import { inkOn, mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { num, str, type MotionProps } from '../types';

const CARD = 36;
const GAP = 3;
const INSET = 7;

/**
 * #24 A pinned section whose row of dishes travels sideways while the page scrolls down: the vertical scroll becomes a
 * horizontal journey. In Arabic and Sorani the row runs from the right and travels the other way.
 */
export default function ScrollHorizontalGallery({ params, playing, speed, progress, dir }: MotionProps) {
  const background = str(params, 'background');
  const ink = inkOn(background, str(params, 'accent'));
  const count = num(params, 'count');
  const travel = Math.max(0, count * (CARD + GAP) - GAP + INSET * 2 - 100);
  const sign = dir === 'rtl' ? 1 : -1;
  const x = useTransform(progress, (p) => `${sign * p * travel}cqw`);
  const bar = useTransform(progress, [0, 1], [0, 1]);
  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <motion.div style={{ position: 'absolute', top: '14cqh', insetInlineStart: `${INSET}cqw`, display: 'flex', gap: `${GAP}cqw`, x }}>
        {Array.from({ length: count }, (_, i) => {
          const dish = dishAt(i);
          return (
            <div key={i} style={{ width: `${CARD}cqw`, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '2cqmin' }}>
              <div style={{ position: 'relative', height: '46cqh', borderRadius: '2cqmin', overflow: 'hidden' }}>
                <DishPicture dish={dish} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2cqmin' }}>
                <TextBar width="55%" color={ink} style={{ opacity: 0.8 }} />
                <span style={{ color: ink, fontWeight: 600, fontSize: '3.2cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
              </div>
            </div>
          );
        })}
      </motion.div>
      <div style={{ position: 'absolute', bottom: '9cqh', insetInline: `${INSET}cqw`, height: '0.6cqmin', borderRadius: 999, background: mix(background, ink, 0.12), overflow: 'hidden' }}>
        <motion.div style={{ position: 'absolute', inset: 0, background: ink, scaleX: bar, transformOrigin: dir === 'rtl' ? 'right' : 'left' }} />
      </div>
    </DomStage>
  );
}
