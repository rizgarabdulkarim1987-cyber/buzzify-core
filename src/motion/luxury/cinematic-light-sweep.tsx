'use client';

import { useRef, type CSSProperties } from 'react';
import { mix } from '../engine/color';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { fract, smoothstep } from '../engine/math';
import { str, type MotionProps } from '../types';

/**
 * #40 A dark title lit by a passing beam. The words sit in near black; a band of warm light crosses them and lights
 * each letter as it passes, with a soft glow behind, then leaves them dark again until the next pass.
 */
export default function CinematicLightSweep({ params, playing, speed, replay, dir }: MotionProps) {
  const background = str(params, 'background');
  const light = str(params, 'color');
  const lit = useRef<HTMLSpanElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  useLoop(
    (t) => {
      const local = fract(t / 4.6);
      const travel = smoothstep(0.08, 0.72, local);
      const x = dir === 'rtl' ? 120 - travel * 140 : -20 + travel * 140;
      const mask = `linear-gradient(100deg, transparent ${x - 16}%, #000 ${x}%, transparent ${x + 16}%)`;
      if (lit.current) {
        lit.current.style.maskImage = mask;
        lit.current.style.webkitMaskImage = mask;
      }
      if (beam.current) {
        beam.current.style.transform = `translateX(${x - 50}%) skewX(-12deg)`;
        beam.current.style.opacity = String(Math.sin(Math.PI * travel) * 0.9);
      }
    },
    { playing, speed, replay, still: 2.2 },
  );
  const title: CSSProperties = { ...fontStyle('serif'), fontSize: '10cqmin', lineHeight: 1.1, maxWidth: '84cqw', textWrap: 'balance' };
  return (
    <DomStage playing={playing} speed={speed} background={background}>
      <div
        ref={beam}
        style={{ position: 'absolute', top: '15%', bottom: '15%', left: 0, width: '100%', background: `radial-gradient(closest-side, ${mix(light, background, 0.6)}, transparent)`, filter: 'blur(3cqmin)' }}
      />
      <div style={CENTER}>
        <div style={{ position: 'relative' }}>
          <span dir="auto" style={{ ...title, display: 'block', color: mix(background, light, 0.12) }}>
            {str(params, 'text')}
          </span>
          <span dir="auto" ref={lit} aria-hidden style={{ ...title, display: 'block', position: 'absolute', inset: 0, color: light, textShadow: `0 0 2cqmin ${light}` }}>
            {str(params, 'text')}
          </span>
        </div>
      </div>
    </DomStage>
  );
}
