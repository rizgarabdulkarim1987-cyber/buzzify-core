'use client';

import { useRef } from 'react';
import { DomStage } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { clamp, easeOutBack, easeOutCubic, hash, smoothstep, TAU } from '../engine/math';
import { palette, Panel } from '../engine/ui';
import { str, type MotionProps } from '../types';

const CYCLE = 4;

/**
 * #99 The order is in: a circle draws itself round, a tick is drawn inside it, the badge pops a little larger and
 * settles, and small pieces of confetti spray out and fall. It fades and confirms again.
 */
export default function OrderConfirmation({ params, playing, speed, replay }: MotionProps) {
  const colour = str(params, 'color');
  const colours = palette(str(params, 'background'), colour);
  const circle = useRef<SVGCircleElement>(null);
  const tick = useRef<SVGPathElement>(null);
  const badge = useRef<SVGSVGElement>(null);
  const confetti = useRef<Array<SVGRectElement | null>>([]);
  useLoop(
    (t) => {
      const local = t % CYCLE;
      const ring = easeOutCubic(clamp(local / 0.6));
      const mark = easeOutCubic(clamp((local - 0.5) / 0.35));
      const pop = local < 0.85 ? 1 : 1 + 0.12 * Math.sin(Math.PI * clamp((local - 0.85) / 0.35));
      const fade = 1 - smoothstep(CYCLE - 0.5, CYCLE, local);
      circle.current?.style.setProperty('stroke-dashoffset', String(1 - ring));
      tick.current?.style.setProperty('stroke-dashoffset', String(1 - mark));
      if (badge.current) {
        badge.current.style.transform = `scale(${pop * easeOutBack(clamp(local / 0.4), 1.4)})`;
        badge.current.style.opacity = String(fade);
      }
      const k = clamp((local - 0.85) / 1.6);
      confetti.current.forEach((piece, i) => {
        if (!piece) return;
        const a = hash(i, 1) * TAU;
        const v = 30 + hash(i, 2) * 26;
        const x = 50 + Math.cos(a) * v * easeOutCubic(k);
        const y = 50 + Math.sin(a) * v * easeOutCubic(k) + k * k * 30;
        piece.setAttribute('transform', `translate(${x} ${y}) rotate(${k * 540 * (hash(i, 3) - 0.5)})`);
        piece.style.opacity = String(k > 0 && k < 1 ? (1 - k) * fade : 0);
      });
    },
    { playing, speed, replay, still: 1.5 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <Panel width="auto" style={{ alignItems: 'center' }}>
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', width: '70cqmin', height: '70cqmin', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', overflow: 'visible' }}>
          {Array.from({ length: 18 }, (_, i) => (
            <rect
              key={i}
              ref={(element) => {
                confetti.current[i] = element;
              }}
              x="-1.2"
              y="-0.6"
              width="2.4"
              height="1.2"
              rx="0.4"
              fill={i % 3 === 0 ? colour : i % 3 === 1 ? '#f2b705' : colours.ink}
              style={{ opacity: 0 }}
            />
          ))}
        </svg>
        <svg ref={badge} viewBox="0 0 100 100" style={{ width: '34cqmin', height: '34cqmin', overflow: 'visible' }}>
          <circle cx="50" cy="50" r="44" fill={colour} opacity="0.12" />
          <circle ref={circle} cx="50" cy="50" r="44" fill="none" stroke={colour} strokeWidth="6" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" transform="rotate(-90 50 50)" />
          <path ref={tick} d="M30 52l13 13 27-29" fill="none" stroke={colour} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" />
        </svg>
      </Panel>
    </DomStage>
  );
}
