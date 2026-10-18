'use client';

import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { damp } from '../engine/math';
import { str } from '../types';

/**
 * #63 The dish follows the pointer: across the frame turns it from one side to the other, up and down tips it toward
 * or away from the guest, with a little lag so it feels heavy. Without a pointer it turns to a slow drifting point.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    const turn = { y: 0, x: 0 };
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const px = frame.width ? frame.pointer.x / frame.width - 0.5 : 0;
        const py = frame.height ? frame.pointer.y / frame.height - 0.5 : 0;
        const dt = frame.dt || 1;
        turn.y = damp(turn.y, px * Math.PI * 1.3, 6, dt);
        turn.x = damp(turn.x, py * 0.5, 6, dt);
        stage.turntable.rotation.set(turn.x, turn.y, 0);
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'] },
);
