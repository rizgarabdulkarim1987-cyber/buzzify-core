'use client';

import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { easeInOutCubic, TAU } from '../engine/math';
import { num, str } from '../types';

const SPIN = 2.2;

/** #2 A full turn that eases in and out, then a pause the designer sets, then the next turn. */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const period = SPIN + num(frame.params, 'pause');
        const turn = Math.floor(frame.t / period);
        const local = frame.t - turn * period;
        stage.turntable.rotation.y = (turn + easeInOutCubic(local / SPIN)) * TAU;
        // A whisper of lift while it turns, so the spin reads as a gesture rather than a machine.
        stage.turntable.position.y = Math.sin(Math.PI * Math.min(1, local / SPIN)) * 0.05;
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'], still: 1.1 },
);
