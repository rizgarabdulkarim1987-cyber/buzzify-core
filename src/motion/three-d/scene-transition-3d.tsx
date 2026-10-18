'use client';

import { Color, Group } from 'three';
import { glMotion } from '../engine/define';
import { buildDish, buildPlinth, DISH_FRAMING, disposeObject, studioScene } from '../engine/dish';
import { easeInOutCubic, lerp } from '../engine/math';
import { str } from '../types';

const APART = 14;
const WARM = new Color('#ffe6c0');
const COOL = new Color('#d6e8ff');

/**
 * #15 Two scenes in one world: a burger in a warm room and an iced drink in a cool one. Progress carries the camera
 * from one to the other on an arc, pulling back and rising mid-way while the room's colour and the light change.
 */
export default glMotion((renderer, params) => {
  const base = studioScene(renderer, { fov: 34 });
  const { scene, camera, key } = base;
  const place = (name: 'burger' | 'glass', x: number) => {
    const station = new Group();
    station.add(buildDish(name).group, buildPlinth(DISH_FRAMING[name].plinth));
    station.position.x = x;
    scene.add(station);
    return station;
  };
  const first = place('burger', 0);
  const second = place('glass', APART);
  const room = new Color();
  const warm = new Color(str(params, 'background'));
  const cool = new Color(str(params, 'accent'));
  scene.background = room;
  return {
    scene,
    camera,
    update(frame) {
      warm.set(String(frame.params.background));
      cool.set(String(frame.params.accent));
      const p = easeInOutCubic(frame.progress);
      const arc = Math.sin(p * Math.PI);
      room.copy(warm).lerp(cool, p);
      key.color.copy(WARM).lerp(COOL, p);
      camera.position.set(lerp(0, APART, p), 1.7 + arc * 1.6, 6.6 + arc * 3.2);
      camera.lookAt(lerp(0, APART, p), 0.45 - arc * 0.2, 0);
      first.rotation.y = frame.t * 0.3;
      second.rotation.y = -frame.t * 0.3;
    },
    dispose: () => disposeObject(scene),
  };
});
