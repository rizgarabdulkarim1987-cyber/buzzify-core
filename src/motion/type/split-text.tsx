'use client';

import type { CSSProperties } from 'react';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { hash } from '../engine/math';
import { cycleOffset, splitText, TITLE } from '../engine/text';
import { str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-split {
  0% { opacity: 0; transform: translate(var(--x), var(--y)) rotate(var(--r)) }
  22% { opacity: 1; transform: translate(0, 0) rotate(0) }
  76% { opacity: 1; transform: translate(0, 0) rotate(0) }
  94% { opacity: 0; transform: translate(calc(var(--x) * -0.6), calc(var(--y) * -0.6)) rotate(calc(var(--r) * -1)) }
  100% { opacity: 0 }
}
.bzm-split { display: inline-block; animation: bzm-split calc(4.8s / var(--m-speed, 1)) cubic-bezier(.23, 1, .32, 1) infinite both; animation-delay: calc((var(--i) * 0.09s - var(--o)) / var(--m-speed, 1)) }
`;

/**
 * #108 The headline comes apart and together: each word flies in from its own side, above, below, left or right,
 * turning a little, lands in place, holds, and flies out the way it came.
 */
export default function SplitTextMotion({ params, playing, speed, replay }: MotionProps) {
  const pieces = splitText(str(params, 'text'), 'word');
  return (
    <DomStage key={replay} playing={playing} speed={speed} background={str(params, 'background')} style={cycleOffset(playing, 1.8)}>
      <MotionStyle id="split-text" css={CSS} />
      <div style={CENTER}>
        <span dir="auto" style={{ ...TITLE, ...fontStyle(str(params, 'font')), fontSize: '11cqmin', color: str(params, 'color') }}>
          {pieces.map((piece, i) => {
            if (piece.space) return ' ';
            const side = piece.index % 4;
            const style = {
              ['--i' as string]: String(piece.index),
              ['--x' as string]: side === 0 ? '-40cqw' : side === 1 ? '40cqw' : '0',
              ['--y' as string]: side === 2 ? '-40cqh' : side === 3 ? '40cqh' : `${(hash(piece.index, 1) - 0.5) * 20}cqh`,
              ['--r' as string]: `${(hash(piece.index, 2) - 0.5) * 40}deg`,
            } as CSSProperties;
            return (
              <span key={i} className="bzm-split" style={style}>
                {piece.text}
              </span>
            );
          })}
        </span>
      </div>
    </DomStage>
  );
}
