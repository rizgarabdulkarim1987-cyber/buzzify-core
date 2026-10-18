'use client';

import { useRef } from 'react';
import { CENTER, DomStage, MotionStyle } from '../engine/dom';
import { ghost, useLoop, usePointer } from '../engine/loop';
import { damp } from '../engine/math';
import { DishPicture, MENU_CSS, SAMPLE_MENU } from '../engine/menu';
import { bool, num, str, type MotionProps } from '../types';

/**
 * #62 A dish card that tilts toward the pointer in 3D, as if held in the hand: the near corner rises, a glare slides
 * across the picture with the light, and the card eases back flat when the pointer leaves.
 */
export default function Hover3dTilt({ params, playing, speed, replay }: MotionProps) {
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const glare = useRef<HTMLDivElement>(null);
  const pointer = usePointer(stage);
  const at = useRef({ x: 0.5, y: 0.5 });
  useLoop(
    (t, dt) => {
      const box = card.current?.getBoundingClientRect();
      let [x, y] = ghost(t, 0.7);
      if (pointer.current.inside && box && stage.current) {
        const stageBox = stage.current.getBoundingClientRect();
        x = (pointer.current.x + stageBox.left - box.left) / box.width;
        y = (pointer.current.y + stageBox.top - box.top) / box.height;
      }
      at.current.x = damp(at.current.x, Math.max(-0.2, Math.min(1.2, x)), 9, dt || 1);
      at.current.y = damp(at.current.y, Math.max(-0.2, Math.min(1.2, y)), 9, dt || 1);
      const tilt = num(params, 'tilt');
      if (card.current) card.current.style.transform = `perspective(900px) rotateX(${(0.5 - at.current.y) * tilt}deg) rotateY(${(at.current.x - 0.5) * tilt}deg)`;
      if (glare.current) {
        glare.current.style.opacity = bool(params, 'glare') ? '1' : '0';
        glare.current.style.background = `radial-gradient(circle at ${at.current.x * 100}% ${at.current.y * 100}%, rgb(255 255 255 / 0.38), rgb(255 255 255 / 0) 55%)`;
      }
    },
    { playing, speed, replay, still: 1.8 },
  );
  return (
    <DomStage ref={stage} playing={playing} speed={speed} background={str(params, 'background')}>
      <MotionStyle id="menu" css={MENU_CSS} />
      <div style={CENTER}>
        <div
          ref={card}
          style={{ position: 'relative', width: '44cqmin', height: '58cqmin', borderRadius: '3cqmin', overflow: 'hidden', boxShadow: '0 5cqmin 10cqmin -4cqmin rgb(0 0 0 / 0.7)', transformStyle: 'preserve-3d', willChange: 'transform' }}
        >
          <DishPicture dish={SAMPLE_MENU[2]!} />
          <div ref={glare} style={{ position: 'absolute', inset: 0, mixBlendMode: 'soft-light' }} />
        </div>
      </div>
    </DomStage>
  );
}
