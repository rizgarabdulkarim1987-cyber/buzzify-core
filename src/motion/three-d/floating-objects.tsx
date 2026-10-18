'use client';

import { Group } from 'three';
import { glMotion } from '../engine/define';
import { buildDish, disposeObject, studioScene, type DishName } from '../engine/dish';
import { hash, lerp } from '../engine/math';
import { num } from '../types';

const MODELS: DishName[] = ['croissant', 'cup', 'glass', 'millefeuille', 'burger'];

/**
 * #6 Dishes drifting in the air at different depths, each bobbing and turning at its own pace. Each kind of dish is
 * built once and cloned, so a dozen floating things cost five dishes' geometry.
 */
export default glMotion(
  (renderer, params) => {
    const { scene, camera } = studioScene(renderer, { fov: 34 });
    const sources = new Map(MODELS.map((name) => [name, buildDish(name)]));
    const count = num(params, 'count');
    const floaters = Array.from({ length: count }, (_, i) => {
      const source = sources.get(MODELS[i % MODELS.length]!)!;
      const holder = new Group();
      const body = source.group.clone();
      body.position.y = -source.height / 2;
      holder.add(body);
      const spread = Math.sqrt(count / 6);
      holder.userData = {
        x: lerp(-3.4, 3.4, hash(i, 1)) * spread,
        y: lerp(-1.4, 1.4, hash(i, 2)) * Math.min(1.3, spread),
        z: lerp(-3.5, 0.8, hash(i, 3)),
        phase: hash(i, 4) * 10,
        spin: (hash(i, 5) - 0.5) * 0.8,
        tilt: (hash(i, 6) - 0.5) * 0.7,
        scale: lerp(0.8, 1.1, hash(i, 7)),
      };
      holder.scale.setScalar(holder.userData.scale as number);
      scene.add(holder);
      return holder;
    });
    camera.position.set(0, 0.4, 10.5);
    camera.lookAt(0, 0, 0);
    return {
      scene,
      camera,
      update(frame) {
        for (const holder of floaters) {
          const d = holder.userData as Record<string, number>;
          const t = frame.t + d.phase!;
          holder.position.set(d.x! + Math.sin(t * 0.31) * 0.15, d.y! + Math.sin(t * 0.7) * 0.22, d.z!);
          holder.rotation.set(d.tilt! + Math.sin(t * 0.5) * 0.18, t * d.spin!, Math.sin(t * 0.43) * 0.12);
        }
      },
      dispose() {
        disposeObject(scene);
        sources.forEach((dish) => disposeObject(dish.group));
      },
    };
  },
  { rebuild: ['count'] },
);
