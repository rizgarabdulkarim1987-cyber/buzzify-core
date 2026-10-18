'use client';

import type { CSSProperties } from 'react';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { cycleOffset, splitText, TITLE } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-rise { 0% { transform: translateY(110%) } 18% { transform: translateY(0) } 78% { transform: translateY(0) } 92% { transform: translateY(-110%) } 100% { transform: translateY(-110%) } }
.bzm-rise-mask { display: inline-block; overflow: hidden; vertical-align: bottom; padding: 0.06em 0.02em 0.12em }
.bzm-rise { display: inline-block; animation: bzm-rise calc(4.6s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc((var(--i) * 0.07s - var(--o)) / var(--m-speed, 1)) }
`;

/**
 * #107 The headline rises into place word by word, each from behind its own edge, holds, and leaves upward the same
 * way. The mask keeps every word crisp: nothing fades, it is simply uncovered.
 */
export default function TextReveal({ params, playing, speed, replay }: MotionProps) {
  const pieces = splitText(str(params, 'text'), 'word');
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={str(params, 'background')} style={cycleOffset(playing, 1.6)}>
      <MotionStyle id="text-reveal" css={CSS} />
      <div style={CENTER}>
        <span dir="auto" style={{ ...TITLE, ...fontStyle(str(params, 'font')), fontSize: '11cqmin', color: str(params, 'color') }}>
          {pieces.map((piece, i) =>
            piece.space ? (
              ' '
            ) : (
              <span key={i} className="bzm-rise-mask">
                <span className="bzm-rise" style={{ ['--i' as string]: String(piece.index) } as CSSProperties}>
                  {piece.text}
                </span>
              </span>
            ),
          )}
        </span>
      </div>
    </DomStage>
  );
}
