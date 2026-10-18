'use client';

import { useId, useRef } from 'react';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { num, str, type MotionProps } from '../types';

/**
 * #116 A word that ripples like liquid: a slow turbulence displaces its outline so the letters waver as if seen
 * through moving water, calming and swelling in turn. `intensity` sets how far the letters move.
 */
export default function LiquidText({ params, playing, speed, replay }: MotionProps) {
  const id = useId().replace(/:/g, '');
  const turbulence = useRef<SVGFETurbulenceElement>(null);
  const displace = useRef<SVGFEDisplacementMapElement>(null);
  useLoop(
    (t) => {
      const swell = 0.5 + 0.5 * Math.sin(t * 0.8);
      turbulence.current?.setAttribute('baseFrequency', `${(0.012 + 0.006 * Math.sin(t * 0.5)).toFixed(4)} ${(0.04 + 0.02 * Math.sin(t * 0.7)).toFixed(4)}`);
      turbulence.current?.setAttribute('seed', String(Math.floor(t * 2) % 100));
      displace.current?.setAttribute('scale', String((6 + 22 * swell) * num(params, 'intensity')));
    },
    { playing, speed, replay, still: 1 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <svg aria-hidden style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id={`${id}-liquid`} x="-10%" y="-30%" width="120%" height="160%">
            <feTurbulence ref={turbulence} type="fractalNoise" baseFrequency="0.012 0.04" numOctaves="2" seed="1" result="noise" />
            <feDisplacementMap ref={displace} in="SourceGraphic" in2="noise" scale="12" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div style={CENTER}>
        <span dir="auto" style={{ ...fontStyle('serif'), fontSize: '22cqmin', lineHeight: 1.1, color: str(params, 'color'), filter: `url(#${id}-liquid)`, whiteSpace: 'nowrap', padding: '0 4cqmin' }}>
          {str(params, 'text')}
        </span>
      </div>
    </DomStage>
  );
}
