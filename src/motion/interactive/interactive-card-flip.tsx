'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { inkOn, mix } from '../engine/color';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { DishPicture, formatPrice, MENU_CSS, SAMPLE_MENU, TextBar } from '../engine/menu';
import { str, type MotionProps } from '../types';

/** What the back of the card lists: ingredients as coloured dots with their lines. */
const INGREDIENTS = ['#c98a3e', '#7cae3c', '#c8402a', '#f2c230', '#5a3020'];

/**
 * #74 A dish card that turns over: press it (or hover) and it flips in 3D to its back, where its ingredients and its
 * price are; press again and it flips back. Untouched, it turns over now and then by itself.
 */
export default function InteractiveCardFlip({ params, playing, speed, replay }: MotionProps) {
  const background = str(params, 'background');
  const accent = str(params, 'accent');
  const [chosen, setChosen] = useState<boolean | null>(null);
  const demo = useSequence([2.4, 2.4], { playing, speed, replay });
  const flipped = chosen ?? demo === 1;
  const dish = SAMPLE_MENU[2]!;
  const face = { position: 'absolute' as const, inset: 0, borderRadius: '3cqmin', overflow: 'hidden', backfaceVisibility: 'hidden' as const, boxShadow: '0 4cqmin 8cqmin -4cqmin rgb(40 24 12 / 0.55)' };
  return (
    <DomStage playing={playing} speed={speed} background={background} style={{ perspective: '1000px' }}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={CENTER}>
        <motion.div
          onClick={() => setChosen(!flipped)}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ type: 'spring', duration: 0.7, bounce: 0.18 }}
          style={{ position: 'relative', width: '44cqmin', height: '60cqmin', transformStyle: 'preserve-3d', cursor: 'pointer' }}
        >
          <div style={face}>
            <DishPicture dish={dish} />
          </div>
          <div style={{ ...face, transform: 'rotateY(180deg)', background: mix(background, '#ffffff', 0.7), padding: '5cqmin', display: 'flex', flexDirection: 'column', gap: '2.4cqmin' }}>
            <TextBar width="70%" height="2.4cqmin" color={accent} />
            {INGREDIENTS.map((colour, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '2cqmin' }}>
                <span style={{ width: '2.6cqmin', height: '2.6cqmin', borderRadius: '50%', background: colour, flex: '0 0 auto' }} />
                <TextBar width={`${60 - i * 7}%`} height="1.3cqmin" color={inkOn(background)} style={{ opacity: 0.35 }} />
              </div>
            ))}
            <span style={{ marginTop: 'auto', alignSelf: 'flex-end', color: accent, fontWeight: 700, fontSize: '6cqmin', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(dish.price)}</span>
          </div>
        </motion.div>
      </div>
    </DomStage>
  );
}
