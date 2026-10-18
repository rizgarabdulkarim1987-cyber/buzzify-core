'use client';

import { explodeOffset } from '@/lib/stage';
import { glMotion } from '../engine/define';
import { dishStage } from '../engine/dish';
import { easeInOutCubic, hash } from '../engine/math';
import { num } from '../types';

/** One cycle: closed, opening, open, closing (seconds). */
const PHASES = [1.1, 1.3, 1.6, 1.2] as const;
const CYCLE = PHASES.reduce((sum, d) => sum + d, 0);

function apart(t: number): number {
  const local = t % CYCLE;
  const [closed, opening, open] = PHASES;
  if (local < closed) return 0;
  if (local < closed + opening) return easeInOutCubic((local - closed) / opening);
  if (local < closed + opening + open) return 1;
  return 1 - easeInOutCubic((local - closed - opening - open) / PHASES[3]);
}

/**
 * #5 A burger taken apart: every layer lifts off the one below in proportion to its height, turning a little on its
 * own as it floats, holds open so each ingredient shows, then closes again. `spread` sets how far apart they float.
 */
export default glMotion((renderer) => {
  const stage = dishStage(renderer, 'burger', { zoom: 0.78 });
  const layers = stage.dish.parts.map((part) => part.layer);
  return {
    scene: stage.scene,
    camera: stage.camera,
    resize: () => stage.refit(),
    update(frame) {
      const a = apart(frame.t);
      const spread = num(frame.params, 'spread');
      stage.dish.parts.forEach((part, i) => {
        part.object.position.y = part.layer.y + explodeOffset('burger', layers, part.kind) * spread * a;
        part.object.rotation.y = (hash(i, 3) - 0.5) * 0.9 * a;
      });
      stage.turntable.rotation.y = 0.4 + frame.t * 0.18;
    },
    dispose: stage.dispose,
  };
}, { still: 3 });
