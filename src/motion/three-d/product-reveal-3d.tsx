'use client';

import { Color, DirectionalLight } from 'three';
import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { easeOutCubic, smoothstep } from '../engine/math';
import { str } from '../types';

const CYCLE = 7;

/**
 * #3 The dish comes up out of the dark: it rises and turns into place while the key light, the studio's reflections and
 * an accent rim light come up together. It holds, sinks back into darkness, and the reveal plays again.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName);
    const accent = new DirectionalLight('#ffcf8a', 0);
    accent.position.set(-2.4, 1.2, -2.6);
    stage.scene.add(accent);
    const key = stage.key.intensity;
    const rim = stage.rim.intensity;
    const tint = new Color();
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const local = frame.t % CYCLE;
        const rise = easeOutCubic(local / 2.4);
        const light = smoothstep(0.2, 2.2, local) * (1 - smoothstep(5.6, 6.8, local));
        stage.turntable.position.y = -0.35 * (1 - rise) - 0.25 * smoothstep(5.6, 6.8, local);
        stage.turntable.rotation.y = -0.9 + rise * 0.9 + local * 0.08;
        stage.key.intensity = key * light;
        stage.rim.intensity = rim * light;
        stage.scene.environmentIntensity = light;
        accent.color.copy(tint.set(String(frame.params.accent)));
        accent.intensity = 3.2 * smoothstep(0.8, 2.6, local) * (1 - smoothstep(5.2, 6.4, local));
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'], still: 3 },
);
