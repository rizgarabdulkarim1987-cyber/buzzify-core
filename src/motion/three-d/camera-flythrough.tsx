'use client';

import { Color, Fog, Group } from 'three';
import { glMotion } from '../engine/define';
import { buildDish, buildPlinth, DISH_FRAMING, disposeObject, studioScene, type DishName } from '../engine/dish';
import { TAU } from '../engine/math';
import { bool, str } from '../types';

const MODELS: DishName[] = ['burger', 'cup', 'croissant', 'glass', 'millefeuille'];
const GAP = 3.4;
const LOOP = MODELS.length * GAP;

/**
 * #8 The camera glides down a long table of dishes on their plinths, weaving gently between them. The row repeats past
 * both ends of the view, so the flight loops without a cut.
 */
export default glMotion((renderer, params) => {
  const { scene, camera } = studioScene(renderer, { fov: 42 });
  const sources = MODELS.map((name) => ({ name, dish: buildDish(name), plinth: buildPlinth(DISH_FRAMING[name].plinth) }));
  for (let k = -2; k < MODELS.length * 3; k++) {
    const source = sources[((k % MODELS.length) + MODELS.length) % MODELS.length]!;
    const station = new Group();
    station.add(source.dish.group.clone(), source.plinth.clone());
    station.position.set(k * GAP, 0, k % 2 === 0 ? -1.1 : 1.1);
    station.rotation.y = k * 0.7;
    scene.add(station);
  }
  const fogColor = new Color(str(params, 'background'));
  scene.fog = bool(params, 'fog') ? new Fog(fogColor, 5, 17) : null;
  return {
    scene,
    camera,
    update(frame) {
      const x = (frame.t * 1.15) % LOOP;
      const sway = Math.sin((x / LOOP) * TAU * 2);
      camera.position.set(x - 2.6, 1.7 + Math.sin(frame.t * 0.5) * 0.2, sway * 0.55);
      camera.lookAt(x + 3, 0.45, sway * 0.25);
      if (scene.fog) (scene.fog as Fog).color.set(String(frame.params.background));
    },
    dispose() {
      disposeObject(scene);
      sources.forEach((source) => {
        disposeObject(source.dish.group);
        disposeObject(source.plinth);
      });
    },
  };
}, { rebuild: ['fog'] });
