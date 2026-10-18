'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { inkOn, mix } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { dishAt, DishPicture, formatPrice, MENU_CSS, TextBar } from '../engine/menu';
import { num, str, type MotionProps } from '../types';

/**
 * #61 Dish cards that answer the pointer: the one under it lifts and grows a little on a quick spring, its shadow
 * deepening, and settles back when the pointer leaves. Without a pointer, the hover moves from card to card on its own.
 */
export default function HoverScale({ params, playing, speed, replay }: MotionProps) {
  const background = str(params, 'background');
  const accent = str(params, 'accent');
  const ink = inkOn(background, '#2b1a12');
  const scale = num(params, 'scale');
  const [hovered, setHovered] = useState<number | null>(null);
  const demo = useSequence([1.4, 1.4, 1.4], { playing, speed, replay });
  const active = hovered ?? demo;
  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={{ position: 'absolute', inset: '14cqh 8cqw', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4cqw', alignItems: 'center' }}>
        {[0, 1, 2].map((i) => {
          const dish = dishAt(i * 2 + 1);
          const on = active === i;
          return (
            <motion.div
              key={i}
              onPointerEnter={() => setHovered(i)}
              onPointerLeave={() => setHovered(null)}
              animate={{ scale: on ? scale : 1, y: on ? -8 : 0, boxShadow: on ? '0 18px 36px -14px rgb(40 24 12 / 0.45)' : '0 4px 10px -6px rgb(40 24 12 / 0.25)' }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0.2 }}
              style={{ borderRadius: '2cqmin', background: mix(background, '#ffffff', 0.6), overflow: 'hidden', cursor: 'pointer', outline: on ? `0.4cqmin solid ${accent}` : 'none', outlineOffset: '-0.4cqmin' }}
            >
              <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
                <DishPicture dish={dish} />
              </div>
              <div style={{ padding: '2.4cqmin', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2cqmin' }}>
                <TextBar width="50%" color={ink} style={{ opacity: 0.8 }} />
                <span style={{ color: ink, fontWeight: 600, fontSize: '3cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </DomStage>
  );
}
