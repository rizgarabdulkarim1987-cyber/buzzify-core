'use client';

import { useId, useRef } from 'react';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { smoothstep } from '../engine/math';
import { str, type MotionProps } from '../types';

const HOLD = 1.4;
const MORPH = 0.9;

/**
 * #110 One word melting into the next: as a word blurs out the next blurs in over it, and a threshold filter turns the
 * overlap into one liquid shape, so the letters seem to flow from one word into the other. Words are taken from the
 * text, separated by commas.
 */
export default function WordMorphing({ params, playing, speed, replay }: MotionProps) {
  const id = useId().replace(/:/g, '');
  const words = str(params, 'text')
    .split(/[,،]\s*/)
    .map((word) => word.trim())
    .filter(Boolean);
  const a = useRef<HTMLSpanElement>(null);
  const b = useRef<HTMLSpanElement>(null);
  useLoop(
    (t) => {
      const period = HOLD + MORPH;
      const index = Math.floor(t / period);
      const local = t - index * period;
      const k = smoothstep(HOLD, period, local);
      const from = words[index % words.length] ?? '';
      const to = words[(index + 1) % words.length] ?? '';
      if (!a.current || !b.current) return;
      if (a.current.textContent !== from) a.current.textContent = from;
      if (b.current.textContent !== to) b.current.textContent = to;
      // Blur grows as each word fades: 8 / opacity, the classic morph, capped so nothing smears off screen.
      a.current.style.filter = `blur(${Math.min(10, 8 / Math.max(0.01, 1 - k) - 8)}px)`;
      a.current.style.opacity = String((1 - k) ** 0.4);
      b.current.style.filter = `blur(${Math.min(10, 8 / Math.max(0.01, k) - 8)}px)`;
      b.current.style.opacity = String(k ** 0.4);
    },
    { playing, speed, replay, still: 0.5 },
  );
  const look = { ...fontStyle(str(params, 'font')), position: 'absolute' as const, left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', textAlign: 'center' as const, fontSize: '16cqmin', lineHeight: 1, color: str(params, 'color'), whiteSpace: 'nowrap' as const };
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <svg aria-hidden style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id={`${id}-threshold`}>
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140" />
          </filter>
        </defs>
      </svg>
      <div style={{ ...CENTER, filter: `url(#${id}-threshold) blur(0.6px)` }}>
        <span ref={a} dir="auto" style={look} />
        <span ref={b} dir="auto" style={look} />
      </div>
    </DomStage>
  );
}
