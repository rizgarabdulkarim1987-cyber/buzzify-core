'use client';

import { useRef } from 'react';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { ghost, useLoop, usePointer } from '../engine/loop';
import { damp } from '../engine/math';
import { DishPicture, MENU_CSS, SAMPLE_MENU } from '../engine/menu';
import { num, str, type MotionProps } from '../types';

/**
 * #66 A magnifier over the dish: a round lens follows the pointer and shows the dish beneath it larger and sharper, so
 * a guest can look at the crumb of a pastry or the glaze on a cake. Without a pointer the lens wanders the plate.
 */
export default function InteractiveProductZoom({ params, playing, speed, replay }: MotionProps) {
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pointer = usePointer(stage);
  const at = useRef({ x: 0.5, y: 0.5 });
  useLoop(
    (t, dt) => {
      const stageBox = stage.current?.getBoundingClientRect();
      const box = card.current?.getBoundingClientRect();
      if (!stageBox || !box || !lens.current || !inner.current) return;
      let [x, y] = ghost(t * 0.7, 3.3);
      x = 0.2 + x * 0.6;
      y = 0.2 + y * 0.6;
      if (pointer.current.inside) {
        x = (pointer.current.x + stageBox.left - box.left) / box.width;
        y = (pointer.current.y + stageBox.top - box.top) / box.height;
      }
      at.current.x = damp(at.current.x, Math.max(0, Math.min(1, x)), 14, dt || 1);
      at.current.y = damp(at.current.y, Math.max(0, Math.min(1, y)), 14, dt || 1);
      const zoom = num(params, 'zoom');
      const size = box.width * 0.42;
      const px = at.current.x * box.width;
      const py = at.current.y * box.height;
      lens.current.style.width = lens.current.style.height = `${size}px`;
      lens.current.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px)`;
      // The picture inside the lens is the card at `zoom` times, placed so the point under the lens stays put.
      inner.current.style.width = `${box.width * zoom}px`;
      inner.current.style.height = `${box.height * zoom}px`;
      inner.current.style.transform = `translate(${size / 2 - px * zoom}px, ${size / 2 - py * zoom}px)`;
    },
    { playing, speed, replay, still: 1 },
  );
  return (
    <DomStage ref={stage} playing={playing} speed={speed} background={str(params, 'background')} style={{ cursor: 'zoom-in' }}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={CENTER}>
        <div ref={card} style={{ position: 'relative', width: '62cqmin', height: '62cqmin', borderRadius: '2.4cqmin', overflow: 'visible' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '2.4cqmin', overflow: 'hidden' }}>
            <DishPicture dish={SAMPLE_MENU[7]!} />
          </div>
          <div
            ref={lens}
            style={{ position: 'absolute', left: 0, top: 0, borderRadius: '50%', overflow: 'hidden', boxShadow: '0 0 0 0.6cqmin #ffffff, 0 2cqmin 5cqmin -1cqmin rgb(0 0 0 / 0.55)' }}
          >
            <div ref={inner} style={{ position: 'absolute', left: 0, top: 0 }}>
              <DishPicture dish={SAMPLE_MENU[7]!} />
            </div>
          </div>
        </div>
      </div>
    </DomStage>
  );
}
