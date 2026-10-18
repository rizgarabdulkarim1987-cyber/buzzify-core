'use client';

import { useId, useRef } from 'react';
import { shade } from '../engine/color';
import { DomStage } from '../engine/dom';
import { FONTS } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { clamp, easeInOutCubic, smoothstep } from '../engine/math';
import { str, type MotionProps } from '../types';

const CYCLE = 7;

/**
 * #45 A wordmark revealed as an engraver would make it: its outline is drawn in a fine gold line, the letters fill
 * with gold, a shine runs across them, and a rule draws out beneath. It holds, fades, and draws again.
 */
export default function PremiumLogoReveal({ params, playing, speed, replay }: MotionProps) {
  const id = useId().replace(/:/g, '');
  const gold = str(params, 'color');
  const outline = useRef<SVGTextElement>(null);
  const fill = useRef<SVGTextElement>(null);
  const shine = useRef<SVGRectElement>(null);
  const rule = useRef<SVGLineElement>(null);
  const group = useRef<SVGGElement>(null);
  useLoop(
    (t) => {
      const local = t % CYCLE;
      const draw = easeInOutCubic(clamp(local / 2.4));
      if (outline.current) outline.current.style.strokeDashoffset = String(1200 * (1 - draw));
      if (fill.current) fill.current.style.opacity = String(smoothstep(2, 3, local));
      if (shine.current) shine.current.setAttribute('x', String(-220 + smoothstep(3, 4.4, local) * 900));
      if (rule.current) rule.current.style.strokeDashoffset = String(260 * (1 - easeInOutCubic(smoothstep(2.6, 3.8, local))));
      if (group.current) group.current.style.opacity = String(1 - smoothstep(6.2, 6.9, local));
    },
    { playing, speed, replay, still: 5 },
  );
  const text = str(params, 'text');
  const latin = !/[؀-ۿ]/.test(text);
  // Long names shrink to stay inside the frame; spaced capitals take more room per letter than joined Arabic.
  const size = Math.round(Math.min(96, 520 / Math.max(1, Array.from(text).length * (latin ? 0.86 : 0.52))));
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={shade(gold, 0.45)} />
            <stop offset="0.48" stopColor={gold} />
            <stop offset="0.52" stopColor={shade(gold, -0.25)} />
            <stop offset="1" stopColor={shade(gold, 0.15)} />
          </linearGradient>
          <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}-letters`}>
            <text x="300" y="160" textAnchor="middle" dominantBaseline="middle" fontFamily={FONTS.serif} fontWeight="600" fontSize={size} letterSpacing={latin ? 14 : 0} fill="#fff">
              {latin ? text.toUpperCase() : text}
            </text>
          </mask>
        </defs>
        <g ref={group}>
          <text
            ref={outline}
            x="300"
            y="160"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily={FONTS.serif}
            fontWeight="600"
            fontSize={size}
            letterSpacing={latin ? 14 : 0}
            fill="none"
            stroke={gold}
            strokeWidth="1.4"
            strokeDasharray="1200"
            strokeDashoffset="1200"
          >
            {latin ? text.toUpperCase() : text}
          </text>
          <text
            ref={fill}
            x="300"
            y="160"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily={FONTS.serif}
            fontWeight="600"
            fontSize={size}
            letterSpacing={latin ? 14 : 0}
            fill={`url(#${id}-gold)`}
            style={{ opacity: 0 }}
          >
            {latin ? text.toUpperCase() : text}
          </text>
          <g mask={`url(#${id}-letters)`}>
            <rect ref={shine} x="-220" y="60" width="160" height="200" fill={`url(#${id}-shine)`} transform="skewX(-20)" />
          </g>
          <line ref={rule} x1="170" x2="430" y1="232" y2="232" stroke={gold} strokeWidth="1.2" strokeDasharray="260" strokeDashoffset="260" />
        </g>
      </svg>
    </DomStage>
  );
}
