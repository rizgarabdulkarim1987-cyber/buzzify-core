'use client';

import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { clamp } from '../engine/math';
import { str } from '../types';

/**
 * #70 Turn the dish by hand: drag sideways to spin it and up or down to tip it, let go and it carries on with the
 * speed it was given, slowing to rest. Untouched, it turns slowly by itself.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    const spin = { y: 0.4, x: 0, vy: 0.35, vx: 0, lastX: 0, lastY: 0, dragging: false, idle: 0 };
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      pointerDown(x, y) {
        spin.dragging = true;
        spin.lastX = x;
        spin.lastY = y;
      },
      update(frame) {
        const dt = frame.dt;
        if (frame.pointer.down && frame.pointer.inside) {
          const dx = frame.pointer.x - spin.lastX;
          const dy = frame.pointer.y - spin.lastY;
          spin.lastX = frame.pointer.x;
          spin.lastY = frame.pointer.y;
          const scale = 6 / Math.max(1, frame.width);
          spin.y += dx * scale;
          spin.x = clamp(spin.x + dy * scale * 0.6, -0.5, 0.6);
          if (dt > 0) {
            spin.vy = (dx * scale) / dt;
            spin.vx = (dy * scale * 0.6) / dt;
          }
          spin.idle = 0;
        } else {
          spin.dragging = false;
          spin.idle += dt;
          spin.y += spin.vy * dt;
          spin.x = clamp(spin.x + spin.vx * dt, -0.5, 0.6);
          spin.vy *= Math.exp(-1.6 * dt);
          spin.vx *= Math.exp(-4 * dt);
          spin.x *= Math.exp(-1.2 * dt);
          // After a rest, a slow turn of its own.
          if (spin.idle > 2) spin.vy += (0.35 - spin.vy) * (1 - Math.exp(-dt));
        }
        stage.turntable.rotation.set(spin.x, spin.y, 0);
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'], touchAction: 'none' },
);
