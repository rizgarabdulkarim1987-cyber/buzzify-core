'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { inkOn, mix } from '../engine/color';
import { DomStage } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { str, type MotionProps } from '../types';

/** The burger's layers from the top: their colour, height (in the drawing's units) and calories. */
const LAYERS = [
  { colour: '#d9963f', height: 16, round: 'top', kcal: 140 },
  { colour: '#f2c230', height: 4, round: 'none', kcal: 80 },
  { colour: '#5a3020', height: 9, round: 'both', kcal: 290 },
  { colour: '#c8402a', height: 4, round: 'none', kcal: 10 },
  { colour: '#7cae3c', height: 4, round: 'wave', kcal: 5 },
  { colour: '#c98a3e', height: 9, round: 'bottom', kcal: 120 },
] as const;

const SPRING = { type: 'spring', duration: 0.55, bounce: 0.18 } as const;
const TOTAL = LAYERS.reduce((sum, layer) => sum + layer.height, 0);
/** Where each layer starts, from the top of the burger. */
const TOPS = LAYERS.map((_, i) => LAYERS.slice(0, i).reduce((sum, layer) => sum + layer.height, 0));

/**
 * #68 A burger that opens to tell what is in it: point at it (or press it) and its layers part, each with a line out
 * to its calories. Point away and it closes. Without a pointer it opens and closes on its own.
 */
export default function InteractiveIngredientReveal({ params, playing, speed, replay, dir }: MotionProps) {
  const background = str(params, 'background');
  const accent = str(params, 'accent');
  const ink = inkOn(background);
  const [hover, setHover] = useState<boolean | null>(null);
  const demo = useSequence([1.6, 2.6], { playing, speed, replay });
  const open = hover ?? demo === 1;
  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <div
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onClick={() => setHover((value) => !value)}
        style={{ position: 'absolute', insetBlock: '8cqh', insetInlineStart: '16cqw', width: '40cqw', cursor: 'pointer' }}
      >
        {LAYERS.map((layer, i) => {
          const top = TOPS[i]!;
          const spread = (i - (LAYERS.length - 1) / 2) * 3.2;
          const radius =
            layer.round === 'top' ? '50% 50% 8% 8% / 90% 90% 10% 10%' : layer.round === 'bottom' ? '8% 8% 40% 40% / 10% 10% 60% 60%' : layer.round === 'both' ? '1.4cqmin' : '0.6cqmin';
          return (
            <motion.div
              key={i}
              animate={{ y: open ? `${spread}cqh` : '0cqh', rotate: open ? (i % 2 === 0 ? -2 : 2) : 0 }}
              transition={{ ...SPRING, delay: open ? i * 0.03 : (LAYERS.length - i) * 0.02 }}
              style={{ position: 'absolute', insetInline: layer.round === 'wave' ? '-3%' : 0, top: `${(top / TOTAL) * 70 + 10}cqh`, height: `${(layer.height / TOTAL) * 70}cqh`, background: layer.colour, borderRadius: radius, boxShadow: 'inset 0 -0.6cqmin 0 rgb(0 0 0 / 0.12)' }}
            >
              <motion.div
                animate={{ opacity: open ? 1 : 0, x: open ? 0 : dir === 'rtl' ? 8 : -8 }}
                transition={{ ...SPRING, delay: open ? 0.12 + i * 0.04 : 0 }}
                style={{ position: 'absolute', insetInlineStart: '104%', top: '50%', display: 'flex', alignItems: 'center', gap: '1.6cqmin', transform: 'translateY(-50%)', whiteSpace: 'nowrap' }}
              >
                <span style={{ width: '9cqw', height: 1, background: mix(background, ink, 0.4) }} />
                <span style={{ width: '1.6cqmin', height: '1.6cqmin', borderRadius: '50%', background: layer.colour, boxShadow: `0 0 0 0.4cqmin ${mix(background, '#ffffff', 0.2)}` }} />
                <span style={{ color: ink, fontSize: '3cqmin', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {layer.kcal}
                  <span style={{ fontWeight: 400, opacity: 0.6, marginInlineStart: '0.6cqmin' }}>kcal</span>
                </span>
              </motion.div>
            </motion.div>
          );
        })}
        <motion.div animate={{ opacity: open ? 1 : 0 }} style={{ position: 'absolute', insetInline: '10%', bottom: '-4cqh', height: '1cqmin', borderRadius: 999, background: accent, filter: 'blur(1cqmin)' }} />
      </div>
    </DomStage>
  );
}
