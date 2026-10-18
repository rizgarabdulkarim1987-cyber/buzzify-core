'use client';

import { useRef } from 'react';
import { DomStage, MotionStyle } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { dishAt, DishPicture, formatPrice, MENU_CSS } from '../engine/menu';
import { num, str, type MotionProps } from '../types';

/**
 * #69 The menu as a carousel in the round: cards stand on a ring and the guest turns it by dragging, with momentum that
 * runs out gently and a snap to the nearest card. Left alone, the ring turns slowly by itself.
 */
export default function Interactive3dMenu({ params, playing, speed, replay }: MotionProps) {
  const count = num(params, 'count');
  const accent = str(params, 'accent');
  const ring = useRef<HTMLDivElement>(null);
  const state = useRef({ angle: 0, velocity: 0, dragging: false, lastX: 0, idle: 0 });
  const step = 360 / count;
  useLoop(
    (_, dt) => {
      const s = state.current;
      if (!s.dragging) {
        s.idle += dt;
        s.angle += s.velocity * dt;
        s.velocity *= Math.exp(-3 * dt);
        if (Math.abs(s.velocity) < 8) {
          // Settle on the nearest card, then drift on after a moment of rest.
          const nearest = Math.round(s.angle / step) * step;
          s.angle += (nearest - s.angle) * (1 - Math.exp(-6 * dt));
          if (s.idle > 1.6) s.velocity = -step * 0.9;
        }
      }
      if (ring.current) ring.current.style.transform = `translateZ(-46cqmin) rotateY(${s.angle}deg)`;
    },
    { playing, speed, replay, still: 0 },
  );
  return (
    <DomStage
      playing={playing}
      speed={speed}
      background={str(params, 'background')}
      style={{ perspective: '1100px', touchAction: 'pan-y', cursor: 'grab' }}
      onPointerDown={(event) => {
        state.current.dragging = true;
        state.current.lastX = event.clientX;
        state.current.idle = 0;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const s = state.current;
        if (!s.dragging) return;
        const dx = event.clientX - s.lastX;
        s.lastX = event.clientX;
        s.angle += dx * 0.35;
        s.velocity = dx * 0.35 * 60;
      }}
      onPointerUp={() => {
        state.current.dragging = false;
        state.current.idle = 0;
      }}
    >
      <MotionStyle id="menu" css={MENU_CSS} />
      <div ref={ring} style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, transformStyle: 'preserve-3d' }}>
        {Array.from({ length: count }, (_, i) => {
          const dish = dishAt(i);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: '26cqmin',
                height: '36cqmin',
                left: '-13cqmin',
                top: '-18cqmin',
                transform: `rotateY(${i * step}deg) translateZ(46cqmin)`,
                borderRadius: '2cqmin',
                overflow: 'hidden',
                boxShadow: `0 0 0 0.25cqmin ${accent}55, 0 3cqmin 6cqmin -3cqmin rgb(0 0 0 / 0.7)`,
                backfaceVisibility: 'hidden',
              }}
            >
              <DishPicture dish={dish} />
              <span style={{ position: 'absolute', insetInlineEnd: '2cqmin', bottom: '2cqmin', padding: '0.6cqmin 1.4cqmin', borderRadius: 999, background: 'rgb(0 0 0 / 0.55)', color: '#fff', fontSize: '2.6cqmin', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(dish.price)}
              </span>
            </div>
          );
        })}
      </div>
    </DomStage>
  );
}
