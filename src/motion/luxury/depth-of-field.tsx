'use client';

import { useRef } from 'react';
import { rgba } from '../engine/color';
import { DomStage, MotionStyle } from '../engine/dom';
import { useLoop } from '../engine/loop';
import { breathe, easeInOutCubic, hash } from '../engine/math';
import { DishCutout, MENU_CSS, SAMPLE_MENU, type SampleDish } from '../engine/menu';
import { num, str, type MotionProps } from '../types';

/** Three dishes at three distances: depth 0 is nearest. */
const TABLE: Array<{ dish: SampleDish; depth: number; left: string; top: string; size: string }> = [
  { dish: SAMPLE_MENU[3]!, depth: 1, left: '58cqw', top: '10cqh', size: '40cqmin' },
  { dish: SAMPLE_MENU[1]!, depth: 0.5, left: '18cqw', top: '24cqh', size: '50cqmin' },
  { dish: SAMPLE_MENU[0]!, depth: 0, left: '46cqw', top: '38cqh', size: '62cqmin' },
];

/**
 * #44 A rack focus across a laid table: the focus travels from the drink at the back to the cup in front and back
 * again, so each dish sharpens as the others soften. Lights in the background stay soft bokeh throughout.
 */
export default function DepthOfField({ params, playing, speed, replay }: MotionProps) {
  const layers = useRef<Array<HTMLDivElement | null>>([]);
  useLoop(
    (t) => {
      const focus = easeInOutCubic(breathe(t / 6));
      const blur = num(params, 'blur');
      layers.current.forEach((layer, i) => {
        if (!layer) return;
        const away = Math.abs(TABLE[i]!.depth - (1 - focus));
        layer.style.filter = `blur(${(away * blur * 0.16).toFixed(2)}cqmin)`;
        layer.style.transform = `scale(${1 + (1 - away) * 0.02})`;
      });
    },
    { playing, speed, replay, still: 1.5 },
  );
  return (
    <DomStage playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${hash(i, 1) * 100}%`,
            top: `${hash(i, 2) * 45}%`,
            width: `${5 + hash(i, 3) * 7}cqmin`,
            height: `${5 + hash(i, 3) * 7}cqmin`,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${rgba('#ffd59a', 0.45)}, ${rgba('#ffd59a', 0.1)} 70%, transparent)`,
            filter: 'blur(0.6cqmin)',
          }}
        />
      ))}
      <div style={{ position: 'absolute', insetInline: 0, bottom: 0, height: '38%', background: 'linear-gradient(180deg, rgb(0 0 0 / 0), rgb(0 0 0 / 0.35))' }} />
      {TABLE.map((place, i) => (
        <div
          key={i}
          ref={(element) => {
            layers.current[i] = element;
          }}
          style={{ position: 'absolute', left: place.left, top: place.top, width: place.size, height: place.size, transform: 'translateX(-50%)', marginInlineStart: 0 }}
        >
          <DishCutout dish={place.dish} />
        </div>
      ))}
    </DomStage>
  );
}
