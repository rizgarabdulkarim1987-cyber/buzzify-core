'use client';

import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { lerp } from '../engine/math';
import { num, str } from '../types';

/**
 * #9 The camera circles the dish while it stays still, rising and dipping as it goes round: the motion of a
 * photographer walking around a table. `height` sets how high above the dish the circle runs.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const { distance, lift, target } = stage.frame;
        const angle = frame.t * 0.42;
        const height = lerp(target + 0.2, lift + 1.4, num(frame.params, 'height')) + Math.sin(frame.t * 0.63) * 0.35;
        const radius = distance * 0.98;
        stage.camera.position.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
        stage.camera.lookAt(0, target, 0);
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'] },
);
