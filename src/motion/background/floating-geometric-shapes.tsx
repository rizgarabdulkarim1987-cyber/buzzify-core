'use client';

import type { CSSProperties } from 'react';
import { DomStage, MotionStyle } from '../engine/dom';
import { hash, lerp } from '../engine/math';
import { num, str, type MotionProps } from '../types';

const CSS = `
@keyframes bzm-geo-float {
  0%, 100% { transform: translate(0, 0) rotate(0deg) }
  50% { transform: translate(var(--dx), var(--dy)) rotate(var(--turn)) }
}
.bzm-geo { position: absolute; animation: bzm-geo-float calc(var(--dur) / var(--m-speed, 1)) ease-in-out infinite; animation-delay: var(--delay) }
`;

const SHAPES = ['circle', 'triangle', 'square', 'ring', 'plus', 'arc'] as const;

function Shape({ kind, colour }: { kind: (typeof SHAPES)[number]; colour: string }) {
  const stroke = { fill: 'none', stroke: colour, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const };
  return (
    <svg viewBox="0 0 40 40" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      {kind === 'circle' && <circle cx="20" cy="20" r="16" {...stroke} />}
      {kind === 'triangle' && <path d="M20 4 36 34H4z" {...stroke} />}
      {kind === 'square' && <rect x="6" y="6" width="28" height="28" rx="3" {...stroke} />}
      {kind === 'ring' && (
        <>
          <circle cx="20" cy="20" r="16" {...stroke} />
          <circle cx="20" cy="20" r="9" {...stroke} />
        </>
      )}
      {kind === 'plus' && <path d="M20 6v28M6 20h28" {...stroke} />}
      {kind === 'arc' && <path d="M4 30a16 16 0 0 1 32 0" {...stroke} />}
    </svg>
  );
}

/**
 * #81 Outlined shapes floating in the background: circles, triangles, squares, rings, crosses and arcs, each drifting
 * and turning on its own slow cycle, so the set never lines up the same way twice.
 */
export default function FloatingGeometricShapes({ params, playing, speed }: MotionProps) {
  const colour = str(params, 'color');
  const count = num(params, 'count');
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="floating-geometric-shapes" css={CSS} />
      {Array.from({ length: count }, (_, i) => {
        const size = lerp(5, 13, hash(i, 1));
        const style = {
          left: `${lerp(4, 90, hash(i, 2))}%`,
          top: `${lerp(4, 86, hash(i, 3))}%`,
          width: `${size}cqmin`,
          height: `${size}cqmin`,
          opacity: lerp(0.35, 0.9, hash(i, 4)),
          ['--dx' as string]: `${lerp(-6, 6, hash(i, 5))}cqmin`,
          ['--dy' as string]: `${lerp(-8, 8, hash(i, 6))}cqmin`,
          ['--turn' as string]: `${lerp(-120, 120, hash(i, 7))}deg`,
          ['--dur' as string]: `${lerp(9, 18, hash(i, 8))}s`,
          ['--delay' as string]: `${-lerp(0, 18, hash(i, 9))}s`,
        } as CSSProperties;
        return (
          <div key={i} className="bzm-geo" style={style}>
            <Shape kind={SHAPES[i % SHAPES.length]!} colour={colour} />
          </div>
        );
      })}
    </DomStage>
  );
}
