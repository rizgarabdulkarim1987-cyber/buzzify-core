'use client';

import { useRef } from 'react';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { breathe, fract } from '../engine/math';
import { brushed, metal } from '../engine/metal';
import { str, type MotionProps } from '../types';

/**
 * #35 A brushed metal plaque with the name engraved in it. A band of reflected light slides across the metal every
 * few seconds while the plaque tilts a degree or two, as polished metal does when a guest moves their head.
 */
export default function MetallicReflection({ params, playing, speed, replay }: MotionProps) {
  const finish = str(params, 'metal');
  const [shadow, , highlight] = metal(finish);
  const plate = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  useLoop(
    (t) => {
      const sweep = fract(t / 4.2);
      if (band.current) band.current.style.transform = `translateX(${-80 + sweep * 260}%) skewX(-18deg)`;
      if (plate.current) plate.current.style.transform = `perspective(900px) rotateY(${(breathe(t / 8) - 0.5) * 6}deg) rotateX(${(breathe(t / 11) - 0.5) * 3}deg)`;
    },
    { playing, speed, replay, still: 1.4 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <div style={CENTER}>
        <div
          ref={plate}
          style={{
            position: 'relative',
            width: '68cqw',
            height: '30cqh',
            borderRadius: '2cqmin',
            background: brushed(finish),
            boxShadow: `0 4cqmin 9cqmin -3cqmin rgb(0 0 0 / 0.7), inset 0 0 0 0.35cqmin ${highlight}55, inset 0 -0.8cqmin 1.4cqmin ${shadow}66`,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            dir="auto"
            style={{
              ...fontStyle('serif'),
              fontSize: '9cqmin',
              letterSpacing: '0.04em',
              color: shadow,
              textShadow: `0 0.25cqmin 0 ${highlight}aa, 0 -0.2cqmin 0 rgb(0 0 0 / 0.35)`,
              whiteSpace: 'nowrap',
            }}
          >
            {str(params, 'text')}
          </span>
          <div
            ref={band}
            style={{
              position: 'absolute',
              inset: '-20% auto -20% 0',
              width: '30%',
              background: `linear-gradient(90deg, transparent, ${highlight}cc 45%, #ffffff 50%, ${highlight}cc 55%, transparent)`,
              mixBlendMode: 'overlay',
              filter: 'blur(1cqmin)',
            }}
          />
        </div>
      </div>
    </DomStage>
  );
}
