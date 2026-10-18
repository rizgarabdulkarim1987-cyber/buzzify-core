'use client';

import { Color, Fog, Group } from 'three';
import { glMotion } from '../engine/define';
import { buildDish, disposeObject, studioScene, type DishName } from '../engine/dish';
import { breathe, easeInOutCubic, hash, lerp } from '../engine/math';
import { num, str } from '../types';

const MODELS: DishName[] = ['cup', 'croissant', 'glass', 'millefeuille', 'burger'];
const COUNT = 14;

/**
 * #10 Dishes hung at many depths in a warm haze; the camera dollies deep into them and back out, so near things sweep
 * past while far ones barely move. The haze is the background colour. `depth` stretches the field.
 */
export default glMotion(
  (renderer, params) => {
    const { scene, camera } = studioScene(renderer, { fov: 40 });
    const depth = num(params, 'depth');
    const sources = new Map(MODELS.map((name) => [name, buildDish(name)]));
    const items = Array.from({ length: COUNT }, (_, i) => {
      const source = sources.get(MODELS[i % MODELS.length]!)!;
      const holder = new Group();
      const body = source.group.clone();
      body.position.y = -source.height / 2;
      holder.add(body);
      const side = i % 2 === 0 ? -1 : 1;
      holder.position.set(side * lerp(1.3, 3.2, hash(i, 1)), lerp(-1.2, 1.2, hash(i, 2)), -i * 2.4 * depth + 1);
      holder.scale.setScalar(1);
      holder.userData = { spin: (hash(i, 3) - 0.5) * 0.6, phase: hash(i, 4) * 6 };
      scene.add(holder);
      return holder;
    });
    scene.fog = new Fog(new Color(str(params, 'background')), 4, 14 * depth + 6);
    return {
      scene,
      camera,
      update(frame) {
        const travel = easeInOutCubic(breathe(frame.t / 9));
        camera.position.set(Math.sin(frame.t * 0.2) * 0.4, 0.2, lerp(8, -COUNT * 1.1 * depth, travel));
        camera.lookAt(0, 0, camera.position.z - 6);
        for (const item of items) {
          const d = item.userData as { spin: number; phase: number };
          item.rotation.y = frame.t * d.spin + d.phase;
        }
        (scene.fog as Fog).color.set(String(frame.params.background));
      },
      dispose() {
        disposeObject(scene);
        sources.forEach((dish) => disposeObject(dish.group));
      },
    };
  },
  { rebuild: ['depth'], still: 2 },
);
