'use client';

import { useRef } from 'react';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { hash } from '../engine/math';
import { num, str, type MotionProps } from '../types';

const CHANNELS = ['#ff2a4d', '#2aff8c', '#3a7bff'] as const;

/**
 * #146 The colour fringe of a cheap lens, used on purpose: the word's red, green and blue separate and drift apart,
 * glitch sideways for a frame now and then, and slide back into clean white type.
 */
export default function ChromaticAberration({ params, playing, speed, replay }: MotionProps) {
  const layers = useRef<Array<HTMLSpanElement | null>>([]);
  useLoop(
    (t) => {
      const strength = num(params, 'intensity');
      const pulse = Math.max(0, Math.sin(t * 1.1)) ** 3;
      const glitchFrame = Math.floor(t * 12);
      const glitch = hash(glitchFrame, 1) > 0.93 ? (hash(glitchFrame, 2) - 0.5) * 3 : 0;
      layers.current.forEach((layer, i) => {
        if (!layer) return;
        const k = (i - 1) * strength;
        layer.style.transform = `translate(${(k * pulse * 1.2 + glitch * (i === 1 ? 0 : 1)).toFixed(2)}cqmin, ${(k * pulse * 0.4).toFixed(2)}cqmin)`;
      });
    },
    { playing, speed, replay, still: 1.4 },
  );
  const look = { ...fontStyle('condensed'), fontSize: '22cqmin', lineHeight: 1, whiteSpace: 'nowrap' as const, textTransform: 'uppercase' as const };
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <div style={CENTER}>
        <span style={{ position: 'relative', display: 'inline-block', isolation: 'isolate' }}>
          <span dir="auto" style={{ ...look, visibility: 'hidden' }}>
            {str(params, 'text')}
          </span>
          {CHANNELS.map((colour, i) => (
            <span
              key={colour}
              ref={(element) => {
                layers.current[i] = element;
              }}
              dir="auto"
              aria-hidden={i > 0}
              style={{ ...look, position: 'absolute', inset: 0, color: colour, mixBlendMode: 'screen' }}
            >
              {str(params, 'text')}
            </span>
          ))}
        </span>
      </div>
    </DomStage>
  );
}
