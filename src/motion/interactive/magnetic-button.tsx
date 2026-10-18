'use client';

import { useRef } from 'react';
import { inkOn } from '../engine/color';
import { CENTER, DomStage } from '../engine/dom';
import { fontStyle } from '../engine/fonts';
import { ghost, useLoop, usePointer } from '../engine/loop';
import { damp } from '../engine/math';
import { num, str, type MotionProps } from '../types';

/**
 * #65 A button with a pull: as the pointer comes near it leans toward it, its label leaning a little further, and when
 * the pointer goes it springs back to rest. The pull is felt only within a field around the button.
 */
export default function MagneticButton({ params, playing, speed, replay }: MotionProps) {
  const stage = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const pointer = usePointer(stage);
  const pull = useRef({ x: 0, y: 0 });
  const accent = str(params, 'accent');
  useLoop(
    (t, dt) => {
      const box = stage.current?.getBoundingClientRect();
      if (!box || !button.current) return;
      const [gx, gy] = ghost(t * 0.9, 0.4);
      let x = gx * box.width;
      let y = gy * box.height;
      if (pointer.current.inside) {
        x = pointer.current.x;
        y = pointer.current.y;
      }
      const cx = box.width / 2;
      const cy = box.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const field = Math.min(box.width, box.height) * 0.42;
      const inside = Math.hypot(dx, dy) < field;
      const strength = num(params, 'intensity');
      pull.current.x = damp(pull.current.x, inside ? dx * 0.4 * strength : 0, 11, dt || 1);
      pull.current.y = damp(pull.current.y, inside ? dy * 0.4 * strength : 0, 11, dt || 1);
      button.current.style.transform = `translate(${pull.current.x}px, ${pull.current.y}px)`;
      if (label.current) label.current.style.transform = `translate(${pull.current.x * 0.35}px, ${pull.current.y * 0.35}px)`;
    },
    { playing, speed, replay, still: 1.2 },
  );
  return (
    <DomStage ref={stage} playing={playing} speed={speed} background={str(params, 'background')}>
      <div style={CENTER}>
        <button
          ref={button}
          type="button"
          style={{
            border: 0,
            borderRadius: 999,
            padding: '3.4cqmin 8cqmin',
            background: accent,
            color: inkOn(accent),
            ...fontStyle('sans'),
            fontSize: '4.4cqmin',
            boxShadow: '0 2cqmin 5cqmin -2cqmin rgb(0 0 0 / 0.5)',
            cursor: 'pointer',
          }}
        >
          <span ref={label} dir="auto" style={{ display: 'inline-block' }}>
            {str(params, 'text')}
          </span>
        </button>
      </div>
    </DomStage>
  );
}
