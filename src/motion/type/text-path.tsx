'use client';

import { useId, useRef } from 'react';
import { DomStage, MotionStyle } from '../engine/dom';
import { FONTS } from '../engine/fonts';
import { useLoop } from '../engine/loop';
import { DishCutout, MENU_CSS, SAMPLE_MENU } from '../engine/menu';
import { str, type MotionProps } from '../types';

/**
 * #120 Text travelling round the rim of a cup seen from above, like the band printed on a coffee sleeve: the line runs
 * along a circle and keeps turning, repeated so the ring is always full.
 */
export default function TextPath({ params, playing, speed, replay, dir }: MotionProps) {
  const id = useId().replace(/:/g, '');
  const path = useRef<SVGTextPathElement>(null);
  const text = str(params, 'text');
  useLoop(
    (t) => {
      const offset = ((t * 4) % 100) * (dir === 'rtl' ? -1 : 1);
      path.current?.setAttribute('startOffset', `${offset}%`);
    },
    { playing, speed, replay, still: 1 },
  );
  const ring = `${text}  ·  ${text}  ·  ${text}  ·  `;
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: '40cqmin', height: '40cqmin', transform: 'translate(-50%, -50%)' }}>
        <DishCutout dish={SAMPLE_MENU[0]!} />
      </div>
      <svg viewBox="0 0 200 200" style={{ position: 'absolute', left: '50%', top: '50%', width: '84cqmin', height: '84cqmin', transform: 'translate(-50%, -50%)', overflow: 'visible' }}>
        <defs>
          <path id={`${id}-circle`} d="M100 100 m-80 0 a80 80 0 1 1 160 0 a80 80 0 1 1 -160 0" />
        </defs>
        <text fill={str(params, 'color')} fontFamily={FONTS.sans} fontWeight="600" fontSize="12" letterSpacing={/[؀-ۿ]/.test(text) ? 0 : 1.5}>
          <textPath ref={path} href={`#${id}-circle`} startOffset="0%" textLength={502} lengthAdjust="spacing">
            {ring}
          </textPath>
        </text>
      </svg>
    </DomStage>
  );
}
