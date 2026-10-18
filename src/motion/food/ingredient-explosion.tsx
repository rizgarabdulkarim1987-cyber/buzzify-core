'use client';

import { Vector3 } from 'three';
import { glMotion } from '../engine/define';
import { dishStage } from '../engine/dish';
import { easeInOutCubic, easeOutCubic, hash, lerp, TAU } from '../engine/math';
import { num } from '../types';

/** Whole, bursting, adrift, flying home (seconds). */
const PHASES = [1.4, 0.8, 1.6, 1.3] as const;
const CYCLE = PHASES.reduce((a, b) => a + b, 0);

function burst(t: number): number {
  const local = t % CYCLE;
  if (local < PHASES[0]) return 0;
  if (local < PHASES[0] + PHASES[1]) return easeOutCubic((local - PHASES[0]) / PHASES[1]);
  if (local < PHASES[0] + PHASES[1] + PHASES[2]) return 1 + ((local - PHASES[0] - PHASES[1]) / PHASES[2]) * 0.08;
  return 1.08 * (1 - easeInOutCubic((local - PHASES[0] - PHASES[1] - PHASES[2]) / PHASES[3]));
}

/**
 * #58 A burger that bursts into its ingredients: buns, patty, lettuce, tomato and pickles fly outward and up, tumbling
 * as they go, hang in the air so each can be seen, and fly back into place. `spread` sets how far they go.
 */
export default glMotion((renderer) => {
  const stage = dishStage(renderer, 'burger', { zoom: 0.62 });
  const flights = stage.dish.parts.map((part, i) => {
    const angle = (i / stage.dish.parts.length) * TAU + hash(i, 1) * 0.8;
    return {
      part,
      direction: new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(lerp(0.8, 1.3, hash(i, 2))),
      lift: lerp(0.4, 1.1, hash(i, 3)) + i * 0.12,
      axis: new Vector3(hash(i, 4) - 0.5, hash(i, 5) - 0.5, hash(i, 6) - 0.5).normalize(),
      turn: lerp(0.8, 1.6, hash(i, 7)) * Math.PI,
    };
  });
  return {
    scene: stage.scene,
    camera: stage.camera,
    resize: () => stage.refit(),
    update(frame) {
      const b = burst(frame.t) * num(frame.params, 'spread');
      for (const f of flights) {
        f.part.object.position.set(f.direction.x * b * 1.4, f.part.layer.y + f.lift * b, f.direction.z * b * 0.9);
        f.part.object.setRotationFromAxisAngle(f.axis, f.turn * b);
      }
      stage.turntable.rotation.y = frame.t * 0.15;
    },
    dispose: stage.dispose,
  };
}, { still: 2.9 });
