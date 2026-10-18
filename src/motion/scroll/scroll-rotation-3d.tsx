'use client';

import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { lerp, TAU } from '../engine/math';
import { num, str } from '../types';

/**
 * #18 The dish turns with the scroll: `turns` full turns from the top of the section to its end, and the camera rises a
 * little as it goes so the top of the dish comes into view. Scrolling back turns it back.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const p = frame.progress;
        stage.turntable.rotation.y = p * num(frame.params, 'turns') * TAU;
        const { distance, lift, target } = stage.frame;
        stage.camera.position.set(0, lerp(lift - 0.35, lift + 0.6, p), distance);
        stage.camera.lookAt(0, target, 0);
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'] },
);
