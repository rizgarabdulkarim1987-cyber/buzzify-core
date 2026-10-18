'use client';

import { useRef } from 'react';
import { shade } from '../engine/color';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { str, type MotionProps } from '../types';

const DEPTH = 18;

/**
 * #115 Letters with real depth: the word is extruded into a solid block in its side colour, lit along its face, and
 * turns slowly in 3D so the depth shows, its shadow moving under it.
 */
export default function Typography3d({ params, playing, speed, replay }: MotionProps) {
  const face = str(params, 'color');
  const side = str(params, 'accent');
  const word = useRef<HTMLSpanElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  useLoop(
    (t) => {
      const yaw = Math.sin(t * 0.6) * 28;
      const pitch = 12 + Math.sin(t * 0.43) * 8;
      if (word.current) {
        word.current.style.transform = `rotateX(${pitch}deg) rotateY(${yaw}deg)`;
        // The extrusion is drawn toward the side away from the viewer as the word turns.
        const dx = -Math.sin((yaw * Math.PI) / 180);
        const layers = Array.from({ length: DEPTH }, (_, i) => `${(dx * (i + 1) * 0.12).toFixed(2)}cqmin ${((i + 1) * 0.12).toFixed(2)}cqmin 0 ${shade(side, -i / (DEPTH * 2.2))}`);
        word.current.style.textShadow = `${layers.join(', ')}, ${(dx * 3).toFixed(2)}cqmin 4cqmin 3cqmin rgb(0 0 0 / 0.55)`;
      }
      if (shadow.current) shadow.current.style.transform = `translateX(${-yaw * 0.3}%) scaleX(${1 - Math.abs(yaw) / 200})`;
    },
    { playing, speed, replay, still: 1.2 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')} style={{ perspective: '900px' }}>
      <div ref={shadow} style={{ position: 'absolute', left: '22%', right: '22%', bottom: '18%', height: '6cqmin', borderRadius: '50%', background: 'rgb(0 0 0 / 0.5)', filter: 'blur(2.6cqmin)' }} />
      <div style={{ ...CENTER, transformStyle: 'preserve-3d' }}>
        <span
          ref={word}
          dir="auto"
          style={{
            ...fontStyle('condensed'),
            fontSize: '22cqmin',
            lineHeight: 1,
            color: face,
            whiteSpace: 'nowrap',
            textTransform: 'uppercase',
          }}
        >
          {str(params, 'text')}
        </span>
      </div>
    </DomStage>
  );
}
