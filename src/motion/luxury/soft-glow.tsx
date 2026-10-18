'use client';

import { useRef } from 'react';
import { rgba } from '../engine/color';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { breathe } from '../engine/math';
import { DishCutout, MENU_CSS, SAMPLE_MENU } from '../engine/menu';
import { num, str, type MotionProps } from '../types';

/**
 * #41 A glow that breathes behind the dish: it swells and fades over five seconds, with a second, wider halo a beat
 * behind it, so the dish seems lit from within rather than spotlit. `size` sets how far the glow reaches.
 */
export default function SoftGlow({ params, playing, speed, replay }: MotionProps) {
  const colour = str(params, 'color');
  const inner = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  useLoop(
    (t) => {
      const size = num(params, 'size');
      const a = breathe(t / 5);
      const b = breathe(t / 5 - 0.18);
      if (inner.current) {
        inner.current.style.transform = `scale(${(0.82 + a * 0.22) * size})`;
        inner.current.style.opacity = String(0.55 + a * 0.4);
      }
      if (outer.current) {
        outer.current.style.transform = `scale(${(1.05 + b * 0.35) * size})`;
        outer.current.style.opacity = String(0.18 + b * 0.25);
      }
    },
    { playing, speed, replay, still: 2.5 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={CENTER}>
        <div ref={outer} style={{ position: 'absolute', width: '80cqmin', height: '80cqmin', borderRadius: '50%', background: `radial-gradient(closest-side, ${rgba(colour, 0.55)}, transparent)`, filter: 'blur(4cqmin)' }} />
        <div ref={inner} style={{ position: 'absolute', width: '46cqmin', height: '46cqmin', borderRadius: '50%', background: `radial-gradient(closest-side, ${rgba(colour, 0.95)}, ${rgba(colour, 0.25)} 60%, transparent)`, filter: 'blur(2cqmin)' }} />
        <div style={{ position: 'relative', width: '60cqmin', height: '60cqmin' }}>
          <DishCutout dish={SAMPLE_MENU[0]!} />
        </div>
      </div>
    </DomStage>
  );
}
