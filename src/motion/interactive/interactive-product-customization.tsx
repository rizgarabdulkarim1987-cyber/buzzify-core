'use client';

import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useState } from 'react';
import { inkOn, mix } from '../engine/color';
import { DomStage } from '../engine/dom';
import { useSequence } from '../engine/loop';
import { formatPrice } from '../engine/menu';
import { str, type MotionProps } from '../types';

const SIZES = [0.78, 0.9, 1] as const;
const SIZE_PRICE = [4, 4.75, 5.5] as const;
/** Milks: the drink's colour with each, and what it adds to the price. */
const MILKS = [
  { colour: '#4a2a17', extra: 0 },
  { colour: '#c69c6d', extra: 0 },
  { colour: '#d8b48a', extra: 0.5 },
  { colour: '#e2c7a2', extra: 0.6 },
] as const;

/** The demo's choices in turn: [size, milk]. */
const DEMO: Array<[number, number]> = [
  [1, 1],
  [2, 1],
  [2, 3],
  [0, 2],
  [0, 0],
];

/**
 * #75 A drink to make one's own: pick a size and the cup grows or shrinks on a spring, pick a milk and the drink takes
 * its colour, and the price rolls to the new total. Untouched, the choices change by themselves.
 */
export default function InteractiveProductCustomization({ params, playing, speed, replay }: MotionProps) {
  const background = str(params, 'background');
  const accent = str(params, 'accent');
  const ink = inkOn(background, accent);
  const [chosen, setChosen] = useState<[number, number] | null>(null);
  const step = useSequence(DEMO.map(() => 1.8), { playing, speed, replay });
  const [size, milk] = chosen ?? DEMO[step]!;
  const total = SIZE_PRICE[size]! + MILKS[milk]!.extra;
  const price = useMotionValue(total);
  const shown = useTransform(price, (value) => formatPrice(value));
  useEffect(() => {
    const control = animate(price, total, { duration: 0.38, ease: [0.23, 1, 0.32, 1] });
    return () => control.stop();
  }, [price, total]);

  const pick = (next: [number, number]) => setChosen(next);
  const chip = (on: boolean) => ({
    width: '7cqmin',
    height: '7cqmin',
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    cursor: 'pointer',
    boxShadow: on ? `0 0 0 0.5cqmin ${background}, 0 0 0 0.9cqmin ${accent}` : `0 0 0 1px ${mix(background, ink, 0.2)}`,
    background: mix(background, '#ffffff', 0.5),
  });

  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <div style={{ position: 'absolute', insetBlock: '8cqh', insetInlineStart: '8cqw', width: '44cqw', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <motion.svg viewBox="0 0 100 120" animate={{ scale: SIZES[size] }} transition={{ type: 'spring', duration: 0.5, bounce: 0.3 }} style={{ width: '100%', height: '100%', transformOrigin: '50% 100%' }}>
          <path d="M20 22h60l-7 90a6 6 0 0 1-6 5H33a6 6 0 0 1-6-5z" fill="#fffaf2" stroke={mix(background, ink, 0.18)} strokeWidth="1" />
          <motion.path d="M23 34h54l-6 76a5 5 0 0 1-5 4H34a5 5 0 0 1-5-4z" animate={{ fill: MILKS[milk]!.colour }} transition={{ duration: 0.5 }} />
          <path d="M16 18h68a3 3 0 0 1 0 6H16a3 3 0 0 1 0-6z" fill={accent} />
          <path d="M28 40c4 20 6 44 8 66" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" fill="none" strokeLinecap="round" />
        </motion.svg>
      </div>
      <div style={{ position: 'absolute', insetInlineEnd: '8cqw', top: '14cqh', bottom: '14cqh', width: '36cqw', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '2.4cqmin', alignItems: 'flex-end' }}>
          {SIZES.map((scale, i) => (
            <button key={i} type="button" aria-label={`${i + 1}`} onClick={() => pick([i, milk])} style={chip(size === i)}>
              <svg viewBox="0 0 20 24" style={{ width: `${2.2 + scale * 2}cqmin` }}>
                <path d="M3 3h14l-2 18H5z" fill={ink} opacity={size === i ? 1 : 0.4} />
              </svg>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '2.4cqmin' }}>
          {MILKS.map((option, i) => (
            <button key={i} type="button" aria-label={`${i + 1}`} onClick={() => pick([size, i])} style={chip(milk === i)}>
              <span style={{ width: '4.4cqmin', height: '4.4cqmin', borderRadius: '50%', background: option.colour }} />
            </button>
          ))}
        </div>
        <motion.span style={{ color: ink, fontWeight: 700, fontSize: '9cqmin', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{shown}</motion.span>
      </div>
    </DomStage>
  );
}
