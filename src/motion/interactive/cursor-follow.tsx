'use client';

import { useRef } from 'react';
import { inkOn, mix, rgba } from '../engine/color';
import { DomStage } from '../engine/dom';
import { ghost, useLoop, usePointer } from '../engine/loop';
import { damp } from '../engine/math';
import { num, str, type MotionProps } from '../types';

/** Things to press on the page, as fractions of the stage. */
const TARGETS = [
  { x: 0.22, y: 0.3, w: 0.2, h: 0.1 },
  { x: 0.5, y: 0.3, w: 0.2, h: 0.1 },
  { x: 0.78, y: 0.3, w: 0.2, h: 0.1 },
  { x: 0.5, y: 0.66, w: 0.42, h: 0.14 },
];

/**
 * #64 A custom cursor for a menu: a dot that sits on the pointer and a ring that trails it on a soft spring. Over
 * something that can be pressed, the ring grows to frame it. Without a pointer, the cursor wanders the page.
 */
export default function CursorFollow({ params, playing, speed, replay }: MotionProps) {
  const stage = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const pointer = usePointer(stage);
  const state = useRef({ rx: 0.5, ry: 0.5, size: 1 });
  const background = str(params, 'background');
  const colour = str(params, 'color');
  const ink = inkOn(background);
  useLoop(
    (t, dt) => {
      const box = stage.current?.getBoundingClientRect();
      if (!box) return;
      let [x, y] = ghost(t * 1.3, 2.1);
      if (pointer.current.inside) {
        x = pointer.current.x / box.width;
        y = pointer.current.y / box.height;
      }
      const s = state.current;
      const k = dt || 1;
      s.rx = damp(s.rx, x, 10, k);
      s.ry = damp(s.ry, y, 10, k);
      const over = TARGETS.some((target) => Math.abs(x - target.x) < target.w / 2 && Math.abs(y - target.y) < target.h / 2);
      s.size = damp(s.size, over ? 2.4 : 1, 12, k);
      const base = Math.min(box.width, box.height) * 0.06 * num(params, 'size');
      if (ring.current) {
        ring.current.style.transform = `translate(${s.rx * box.width - (base * s.size) / 2}px, ${s.ry * box.height - (base * s.size) / 2}px)`;
        ring.current.style.width = ring.current.style.height = `${base * s.size}px`;
        ring.current.style.background = rgba(colour, over ? 0.18 : 0);
      }
      if (dot.current) dot.current.style.transform = `translate(${x * box.width - 3}px, ${y * box.height - 3}px) scale(${over ? 0 : 1})`;
    },
    { playing, speed, replay, still: 2 },
  );
  return (
    <DomStage ref={stage} playing={playing} speed={speed} background={background} style={{ cursor: 'none' }}>
      {TARGETS.map((target, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${(target.x - target.w / 2) * 100}%`,
            top: `${(target.y - target.h / 2) * 100}%`,
            width: `${target.w * 100}%`,
            height: `${target.h * 100}%`,
            borderRadius: 999,
            border: `1px solid ${mix(background, ink, 0.25)}`,
            background: i === 3 ? colour : 'transparent',
          }}
        />
      ))}
      <div ref={ring} style={{ position: 'absolute', left: 0, top: 0, borderRadius: '50%', border: `2px solid ${colour}`, pointerEvents: 'none' }} />
      <div ref={dot} style={{ position: 'absolute', left: 0, top: 0, width: 6, height: 6, borderRadius: '50%', background: colour, pointerEvents: 'none', transition: 'transform 120ms' }} />
    </DomStage>
  );
}
