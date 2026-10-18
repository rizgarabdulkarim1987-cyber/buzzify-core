'use client';

import type { CSSProperties } from 'react';
import { mix } from '../engine/color';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { cycleOffset } from '../engine/text';
import { str, type MotionProps } from '../types';

const SLOT = 0.75;

/** Keyframes for `n` words, each on screen for its own slot of the cycle: punched in large, settled, gone. */
function css(n: number): string {
  const slot = 100 / n;
  const at = (k: number) => `${Math.min(100, k * slot).toFixed(3)}%`;
  return `
@keyframes bzm-kinetic-${n} {
  0% { opacity: 0; transform: scale(1.9) rotate(-4deg); filter: blur(0.6cqmin) }
  ${at(0.12)} { opacity: 1; transform: scale(0.94) rotate(1deg); filter: blur(0) }
  ${at(0.3)} { opacity: 1; transform: scale(1) rotate(0deg) }
  ${at(0.86)} { opacity: 1; transform: scale(1.04) rotate(0deg) }
  ${at(1)} { opacity: 0; transform: scale(0.7) rotate(2deg) }
  100% { opacity: 0; transform: scale(0.7) }
}
@keyframes bzm-kinetic-bar-${n} { 0% { transform: scaleX(0) } ${at(0.3)} { transform: scaleX(1) } ${at(0.86)} { transform: scaleX(1) } ${at(1)} { transform: scaleX(0) } 100% { transform: scaleX(0) } }
.bzm-kinetic-${n} { position: absolute; animation: bzm-kinetic-${n} calc(${n * SLOT}s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc((var(--i) * ${SLOT}s - var(--o)) / var(--m-speed, 1)) }
.bzm-kinetic-bar-${n} { position: absolute; transform-origin: var(--bzm-start, left); animation: bzm-kinetic-bar-${n} calc(${n * SLOT}s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc((var(--i) * ${SLOT}s - var(--o)) / var(--m-speed, 1)) }
`;
}

/**
 * #106 Words punched in to a beat: one at a time, each slams in large and slightly turned, snaps to size, holds for its
 * beat with a rule under it, and gives way to the next. Works for any short line: "Fresh. Bold. Yours."
 */
export default function KineticTypography({ params, playing, speed, replay }: MotionProps) {
  const words = str(params, 'text')
    .split(/[\s.،,]+/)
    .filter(Boolean);
  const n = Math.max(1, words.length);
  const colour = str(params, 'color');
  const background = str(params, 'background');
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={background} style={cycleOffset(playing, SLOT * 0.5)}>
      <MotionStyle id={`kinetic-${n}`} css={css(n)} />
      <div style={CENTER}>
        {words.map((word, i) => (
          <span key={i} style={{ ['--i' as string]: String(i) } as CSSProperties}>
            <span dir="auto" className={`bzm-kinetic-${n}`} style={{ ...fontStyle(str(params, 'font')), left: '50%', top: '50%', translate: '-50% -55%', fontSize: '18cqmin', lineHeight: 1, color: colour, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>
              {word}
            </span>
            <span className={`bzm-kinetic-bar-${n}`} style={{ left: '30%', right: '30%', top: '66%', height: '1.2cqmin', background: mix(colour, background, 0.25) }} />
          </span>
        ))}
      </div>
    </DomStage>
  );
}
