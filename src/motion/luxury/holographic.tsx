'use client';

import { useRef } from 'react';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { ghost, useLoop, usePointer } from '../engine/loop';
import { damp } from '../engine/math';
import { num, str, type MotionProps } from '../types';

/**
 * #38 A members' card in holographic foil. Its rainbow sheen and sparkle sit at the angle of the light, which follows
 * the pointer: tilt the card and the colours slide across it. With no pointer over it, it tilts in a slow drift.
 */
export default function Holographic({ params, playing, speed, replay }: MotionProps) {
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const foil = useRef<HTMLDivElement>(null);
  const glare = useRef<HTMLDivElement>(null);
  const pointer = usePointer(stage);
  const tilt = useRef({ x: 0.5, y: 0.5 });
  useLoop(
    (t, dt) => {
      const box = stage.current?.getBoundingClientRect();
      let [gx, gy] = ghost(t, 1.3);
      if (pointer.current.inside && box) {
        gx = pointer.current.x / box.width;
        gy = pointer.current.y / box.height;
      }
      tilt.current.x = damp(tilt.current.x, gx, 7, dt || 1);
      tilt.current.y = damp(tilt.current.y, gy, 7, dt || 1);
      const { x, y } = tilt.current;
      const strength = num(params, 'intensity');
      if (card.current) card.current.style.transform = `perspective(1000px) rotateY(${(x - 0.5) * 26}deg) rotateX(${(0.5 - y) * 20}deg)`;
      if (foil.current) {
        foil.current.style.backgroundPosition = `${x * 100}% ${y * 100}%, ${100 - x * 100}% ${y * 60}%`;
        foil.current.style.opacity = String(0.45 + strength * 0.5);
      }
      if (glare.current) glare.current.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgb(255 255 255 / ${0.25 + strength * 0.35}), transparent 45%)`;
    },
    { playing, speed, replay, still: 2 },
  );
  return (
    <DomStage ref={stage} playing={playing} speed={speed} background={str(params, 'background')}>
      <div style={CENTER}>
        <div
          ref={card}
          style={{
            position: 'relative',
            width: '58cqmin',
            height: '36.5cqmin',
            borderRadius: '2.6cqmin',
            background: 'linear-gradient(135deg, #2a2d3a, #15161d)',
            boxShadow: '0 4cqmin 10cqmin -4cqmin rgb(0 0 0 / 0.8), inset 0 0 0 0.25cqmin rgb(255 255 255 / 0.18)',
            overflow: 'hidden',
            transformStyle: 'preserve-3d',
          }}
        >
          <div
            ref={foil}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(115deg, #ff7eb3, #ffd36e, #8affc1, #7ec8ff, #c49bff, #ff7eb3), repeating-radial-gradient(circle at 30% 40%, rgb(255 255 255 / 0.5) 0 0.15cqmin, transparent 0.15cqmin 1.2cqmin)',
              backgroundSize: '300% 300%, 160% 160%',
              mixBlendMode: 'color-dodge',
            }}
          />
          <div ref={glare} style={{ position: 'absolute', inset: 0, mixBlendMode: 'overlay' }} />
          <div style={{ position: 'absolute', insetInlineStart: '6cqmin', top: '6cqmin', width: '8cqmin', height: '6cqmin', borderRadius: '1cqmin', background: 'linear-gradient(135deg, #f2e4c4, #b8933f)' }} />
          <span
            dir="auto"
            style={{ position: 'absolute', insetInlineStart: '6cqmin', bottom: '5cqmin', ...fontStyle('serif'), fontSize: '6cqmin', color: 'rgb(255 255 255 / 0.92)', textShadow: '0 0.2cqmin 0.6cqmin rgb(0 0 0 / 0.4)' }}
          >
            {str(params, 'text')}
          </span>
        </div>
      </div>
    </DomStage>
  );
}
