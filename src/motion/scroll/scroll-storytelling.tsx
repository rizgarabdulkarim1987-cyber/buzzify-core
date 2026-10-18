'use client';

import { motion, useTransform, type MotionValue } from 'motion/react';
import { mix } from '../engine/color';
import { DomStage } from '../engine/dom';
import { clamp } from '../engine/math';
import { str, type MotionProps } from '../types';

/** The four chapters as line drawings (viewBox 0 0 100 100): the bean, the roast's flame, the brew, the cup. */
const CHAPTERS = [
  ['M50 14c-20 0-32 18-32 36s12 36 32 36 32-18 32-36-12-36-32-36z', 'M50 16c-10 12 10 22 0 34s10 22 0 34'],
  ['M50 88c-18 0-28-12-28-27 0-18 16-24 18-42 10 8 12 18 10 26 4-4 6-8 6-14 10 8 22 16 22 30 0 15-10 27-28 27z', 'M50 88c-8 0-12-6-12-12 0-8 8-12 12-20 4 8 12 12 12 20 0 6-4 12-12 12z'],
  ['M26 44h38l-6 30H32z', 'M64 50c10 0 12 14 0 16', 'M45 20c0 6 6 6 6 12', 'M38 86h28', 'M45 34v6'],
  ['M24 46h50c0 22-10 36-25 36S24 68 24 46z', 'M74 52c12 0 12 16 0 16', 'M18 86h62', 'M40 18c-4 6 4 8 0 14', 'M52 14c-4 6 4 8 0 14'],
];

function Chapter({ index, chapter, colour }: { index: number; chapter: MotionValue<number>; colour: string }) {
  const distance = useTransform(chapter, (c) => c - index);
  const opacity = useTransform(distance, (d) => clamp(1 - Math.abs(d) * 1.6));
  const y = useTransform(distance, (d) => `${-d * 14}cqh`);
  const scale = useTransform(distance, (d) => 1 - Math.min(1, Math.abs(d)) * 0.12);
  // Each drawing is traced as its chapter arrives: from nothing at the previous chapter to whole at its own.
  const drawn = useTransform(distance, (d) => clamp(d + 1));
  return (
    <motion.svg
      viewBox="0 0 100 100"
      style={{ position: 'absolute', left: '50%', top: '42%', width: '46cqmin', height: '46cqmin', margin: '-23cqmin 0 0 -23cqmin', y, opacity, scale }}
      fill="none"
      stroke={colour}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {CHAPTERS[index]!.map((d, i) => (
        <motion.path key={i} d={d} style={{ pathLength: drawn }} />
      ))}
    </motion.svg>
  );
}

function Segment({ index, chapter, colour }: { index: number; chapter: MotionValue<number>; colour: string }) {
  const fill = useTransform(chapter, (c) => clamp(c - index + 1));
  return (
    <span style={{ position: 'relative', width: '9cqw', height: '0.7cqmin', borderRadius: 999, background: mix(colour, '#000000', 0.55), overflow: 'hidden' }}>
      <motion.span style={{ position: 'absolute', inset: 0, background: colour, scaleX: fill, transformOrigin: 'var(--bzm-start, left)' }} />
    </span>
  );
}

/**
 * #20 A story told by the scroll in four chapters: the bean, the roast, the brew, the cup. Each chapter's drawing traces
 * itself in as it arrives and drifts up as the next one comes; a four-part rail shows how far the story has gone.
 */
export default function ScrollStorytelling({ params, playing, speed, progress, dir }: MotionProps) {
  const background = str(params, 'background');
  const accent = str(params, 'accent');
  const chapter = useTransform(progress, (p) => p * 3);
  const glow = useTransform(chapter, (c) => `radial-gradient(60% 55% at 50% 42%, ${mix(background, accent, 0.12 + 0.05 * Math.sin(c * Math.PI))}, ${background} 72%)`);
  return (
    <DomStage playing={playing} speed={speed} style={{ ['--bzm-start' as string]: dir === 'rtl' ? 'right' : 'left' }}>
      <motion.div style={{ position: 'absolute', inset: 0, background: glow }} />
      {CHAPTERS.map((_, i) => (
        <Chapter key={i} index={i} chapter={chapter} colour={accent} />
      ))}
      <div style={{ position: 'absolute', bottom: '9cqh', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: '1.6cqw' }}>
        {CHAPTERS.map((_, i) => (
          <Segment key={i} index={i} chapter={chapter} colour={accent} />
        ))}
      </div>
    </DomStage>
  );
}
