'use client';

import { glMotion } from '../engine/define';
import { dishStage } from '../engine/dish';
import { clamp, smoothstep } from '../engine/math';
import { num } from '../types';

const STAGGER = 0.38;
const DROP = 2.4;
const HOLD = 2.6;
const LEAVE = 0.8;

/**
 * #4 A mille-feuille assembled layer by layer: each sheet of pastry and cream drops in on a spring, squashes a little
 * as it lands, and settles. The finished dish holds, lifts away, and is built again. `bounce` loosens the spring.
 */
export default glMotion(
  (renderer) => {
    const stage = dishStage(renderer, 'millefeuille');
    const parts = stage.dish.parts.map((part) => ({ part, y: part.layer.y + DROP, v: 0 }));
    const cycle = parts.length * STAGGER + 1 + HOLD + LEAVE;
    let round = 0;
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const local = frame.t % cycle;
        const restart = Math.floor(frame.t / cycle) !== round;
        round = Math.floor(frame.t / cycle);
        const leaving = smoothstep(cycle - LEAVE, cycle, local);
        const damping = 18 - num(frame.params, 'bounce') * 12;
        const steps = Math.max(1, Math.ceil(frame.dt / (1 / 120)));
        const h = frame.dt / steps;
        parts.forEach((p, i) => {
          if (restart) {
            p.y = p.part.layer.y + DROP;
            p.v = 0;
          }
          const started = local >= i * STAGGER;
          const goal = started ? p.part.layer.y + leaving * 1.6 : p.part.layer.y + DROP;
          for (let s = 0; s < steps; s++) {
            p.v += ((goal - p.y) * 170 - p.v * damping) * h;
            p.y += p.v * h;
          }
          const squash = 1 - clamp(Math.abs(p.v) * 0.012, 0, 0.1);
          const scale = 1 - leaving;
          p.part.object.visible = started && scale > 0.01;
          p.part.object.position.y = p.y;
          p.part.object.scale.set(scale / Math.sqrt(squash), Math.max(0.001, scale * squash), scale / Math.sqrt(squash));
        });
        stage.turntable.rotation.y = 0.5 + Math.sin(frame.t * 0.3) * 0.35;
      },
      dispose: stage.dispose,
    };
  },
  { still: 3.9 },
);
