'use client';

import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { str } from '../types';

/** #1 A dish turning slowly on its plinth, lit like the menu's own 3D stage. */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        stage.turntable.rotation.y = frame.t * 0.45;
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'] },
);
