'use client';

import { useRef } from 'react';
import { DomStage } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { clamp, easeInOutCubic, smoothstep } from '../engine/math';
import { FONT, palette, Panel } from '../engine/ui';
import { str, type MotionProps } from '../types';

/** The work in four steps, each with its own pace: quick, slow, quick, a pause before done (seconds). */
const STEPS = [0.7, 1.4, 0.8, 0.6] as const;
const HOLD = 1.4;
const TOTAL = STEPS.reduce((a, b) => a + b, 0);

/**
 * #101 Progress shown honestly: a ring and a bar fill together in four uneven steps, as real work does, with the
 * percentage counting alongside and each step's dot lighting as it is reached. Done, it holds, and starts again.
 */
export default function ProgressIndicator({ params, playing, speed, replay }: MotionProps) {
  const colours = palette(str(params, 'background'), str(params, 'accent'));
  const ring = useRef<SVGCircleElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const dots = useRef<Array<HTMLSpanElement | null>>([]);
  useLoop(
    (t) => {
      const local = t % (TOTAL + HOLD);
      let done = 0;
      let elapsed = local;
      for (let i = 0; i < STEPS.length; i++) {
        const k = clamp(elapsed / STEPS[i]!);
        done += easeInOutCubic(k) / STEPS.length;
        elapsed -= STEPS[i]!;
        dots.current[i]?.style.setProperty('background', k >= 1 ? colours.accent : colours.line);
        dots.current[i]?.style.setProperty('transform', `scale(${k >= 1 ? 1 : 0.7})`);
      }
      const p = done * (1 - smoothstep(TOTAL + HOLD - 0.25, TOTAL + HOLD, local));
      ring.current?.style.setProperty('stroke-dashoffset', String(1 - p));
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      if (label.current) label.current.textContent = `${Math.round(p * 100)}%`;
    },
    { playing, speed, replay, still: 2.2 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={colours.background}>
      <Panel width="50cqw" style={{ alignItems: 'center', gap: '4cqmin' }}>
        <div style={{ position: 'relative', width: '30cqmin', height: '30cqmin' }}>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
            <circle cx="50" cy="50" r="42" fill="none" stroke={colours.line} strokeWidth="8" />
            <circle ref={ring} cx="50" cy="50" r="42" fill="none" stroke={colours.accent} strokeWidth="8" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" transform="rotate(-90 50 50)" />
          </svg>
          <span ref={label} style={{ ...FONT, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colours.ink, fontSize: '6cqmin', fontVariantNumeric: 'tabular-nums' }}>
            0%
          </span>
        </div>
        <div style={{ position: 'relative', width: '100%', height: '1.6cqmin', borderRadius: 999, background: colours.line, overflow: 'hidden' }}>
          <div ref={bar} style={{ position: 'absolute', inset: 0, background: colours.accent, transformOrigin: 'var(--bzm-start, left)', transform: 'scaleX(0)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              ref={(element) => {
                dots.current[i] = element;
              }}
              style={{ width: '2.4cqmin', height: '2.4cqmin', borderRadius: '50%', background: colours.line, transition: 'transform 200ms, background 200ms' }}
            />
          ))}
        </div>
      </Panel>
    </DomStage>
  );
}
