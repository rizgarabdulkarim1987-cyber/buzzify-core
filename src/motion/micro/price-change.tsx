'use client';

import { AnimatePresence, motion } from 'motion/react';
import { RollingNumber } from '../engine/digits';
import { DomStage, MotionStyle } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { DishPicture, formatPrice, MENU_CSS, SAMPLE_MENU, TextBar } from '../engine/menu';
import { FONT, palette, Panel } from '../engine/ui';
import { str, type MotionProps } from '../types';

/** Prices the demo moves between; a lower one shows the old price struck through, as an offer does. */
const PRICES = [12.5, 14, 9.75, 12.5] as const;

/**
 * #95 A price that rolls to its new value: each digit turns over like an odometer, the new price flashes the accent
 * colour for a moment, and when it drops the old price stays beside it, struck through.
 */
export default function PriceChange({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const step = useSequence(PRICES.map(() => 1.8), { playing, speed, replay });
  const price = PRICES[step]!;
  const before = PRICES[(step - 1 + PRICES.length) % PRICES.length]!;
  const drop = price < before;
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <Panel width="54cqw">
        <div style={{ position: 'relative', aspectRatio: '16 / 10', borderRadius: '2.4cqmin', overflow: 'hidden' }}>
          <DishPicture dish={SAMPLE_MENU[5]!} />
        </div>
        <TextBar width="60%" height="2.2cqmin" color={colours.ink} style={{ opacity: 0.85 }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3cqmin' }}>
          <motion.span key={step} initial={{ color: colours.accent }} animate={{ color: colours.ink }} transition={{ duration: 1.2 }} style={{ display: 'inline-flex' }}>
            <RollingNumber value={formatPrice(price)} style={{ ...FONT, fontSize: '9cqmin' }} />
          </motion.span>
          <AnimatePresence>
            {drop && (
              <motion.span
                key={before}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                style={{ ...FONT, fontSize: '4.4cqmin', color: colours.muted, textDecoration: 'line-through', fontVariantNumeric: 'tabular-nums' }}
              >
                {formatPrice(before)}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </Panel>
    </DomStage>
  );
}
