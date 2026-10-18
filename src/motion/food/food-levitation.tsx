'use client';

import { BoxGeometry, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { glMotion } from '../engine/define';
import { dishStage, type DishName } from '../engine/dish';
import { hash, lerp, TAU } from '../engine/math';
import { num, str } from '../types';

const CRUMBS = 22;

/**
 * #60 The dish floats above its plinth as if weightless: it rises and sinks on a slow breath, tilting a little, while
 * its shadow on the plinth tightens and darkens as it comes down. Crumbs drift around it. `height` sets the float.
 */
export default glMotion(
  (renderer, params) => {
    const stage = dishStage(renderer, str(params, 'model') as DishName, { zoom: 0.9 });
    const shadow = stage.plinth?.children.at(-1);
    const crumbs = new InstancedMesh(new BoxGeometry(0.035, 0.025, 0.03), new MeshStandardMaterial({ color: '#c98f4a', roughness: 0.7 }), CRUMBS);
    stage.scene.add(crumbs);
    const dummy = new Object3D();
    return {
      scene: stage.scene,
      camera: stage.camera,
      resize: () => stage.refit(),
      update(frame) {
        const float = num(frame.params, 'height');
        const breath = 0.5 + 0.5 * Math.sin(frame.t * 1.1);
        const lift = 0.12 + breath * float * 0.7;
        stage.turntable.position.y = lift;
        stage.turntable.rotation.set(Math.sin(frame.t * 0.7) * 0.06, frame.t * 0.3, Math.sin(frame.t * 0.9) * 0.05);
        if (shadow) {
          shadow.scale.setScalar(lerp(1, 0.7, lift / (0.12 + float * 0.7)));
          const material = (shadow as unknown as { material: { opacity: number } }).material;
          material.opacity = lerp(0.65, 0.3, lift / (0.12 + float * 0.7));
        }
        for (let i = 0; i < CRUMBS; i++) {
          const a = hash(i, 1) * TAU + frame.t * lerp(0.1, 0.3, hash(i, 2));
          const r = lerp(0.9, 1.6, hash(i, 3));
          dummy.position.set(Math.cos(a) * r, lerp(0.2, 1.4, hash(i, 4)) + Math.sin(frame.t + i) * 0.08 + lift * 0.5, Math.sin(a) * r);
          dummy.rotation.set(frame.t * hash(i, 5), frame.t * hash(i, 6), 0);
          dummy.updateMatrix();
          crumbs.setMatrixAt(i, dummy.matrix);
        }
        crumbs.instanceMatrix.needsUpdate = true;
      },
      dispose: stage.dispose,
    };
  },
  { rebuild: ['model'] },
);
