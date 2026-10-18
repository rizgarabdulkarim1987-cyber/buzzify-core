'use client';

import { useRef } from 'react';
import { rgba } from '../engine/color';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { fract, smoothstep } from '../engine/math';
import { DishCutout, MENU_CSS, SAMPLE_MENU } from '../engine/menu';
import { str, type MotionProps } from '../types';

/**
 * #37 A dish behind a pane of tinted glass, as in a pastry counter. The glass softens what is behind it a little and
 * carries a long reflection that glides across every few seconds, brightest at its leading edge.
 */
export default function GlassReflection({ params, playing, speed, replay }: MotionProps) {
  const tint = str(params, 'color');
  const streak = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  useLoop(
    (t) => {
      const local = fract(t / 5);
      const x = -60 + smoothstep(0.1, 0.75, local) * 220;
      if (streak.current) streak.current.style.transform = `translateX(${x}%) rotate(18deg)`;
      if (edge.current) edge.current.style.opacity = String(0.35 + 0.65 * Math.sin(Math.PI * smoothstep(0.1, 0.75, local)));
    },
    { playing, speed, replay, still: 2.2 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={CENTER}>
        <div style={{ position: 'relative', width: '58cqmin', height: '58cqmin' }}>
          <DishCutout dish={SAMPLE_MENU[1]!} />
        </div>
      </div>
      <div
        ref={edge}
        style={{
          position: 'absolute',
          inset: '12cqh 14cqw',
          borderRadius: '2.4cqmin',
          background: `linear-gradient(135deg, ${rgba(tint, 0.2)}, ${rgba(tint, 0.06)} 40%, ${rgba(tint, 0.14)})`,
          backdropFilter: 'blur(0.35cqmin) saturate(1.15)',
          boxShadow: `inset 0 0 0 0.3cqmin ${rgba('#ffffff', 0.35)}, inset 0 0.4cqmin 0 ${rgba('#ffffff', 0.5)}, 0 3cqmin 6cqmin -3cqmin rgb(0 0 0 / 0.45)`,
          overflow: 'hidden',
        }}
      >
        <div
          ref={streak}
          style={{
            position: 'absolute',
            top: '-40%',
            bottom: '-40%',
            left: 0,
            width: '22%',
            background: `linear-gradient(90deg, transparent, ${rgba('#ffffff', 0.55)} 30%, ${rgba('#ffffff', 0.12)} 60%, transparent)`,
          }}
        />
      </div>
    </DomStage>
  );
}
