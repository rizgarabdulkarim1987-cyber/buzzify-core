'use client';

import { CatmullRomCurve3, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { glMotion } from '../engine/define';
import { buildDish, buildPlinth, DISH_FRAMING, disposeObject, studioScene, type DishName } from '../engine/dish';
import { easeInOutCubic, hash } from '../engine/math';
import { drawnTexture } from '../engine/textures';

const TABLE: Array<{ name: DishName; at: [number, number] }> = [
  { name: 'cup', at: [-3.2, 1.2] },
  { name: 'croissant', at: [-1, -1.1] },
  { name: 'burger', at: [1.6, 1.1] },
  { name: 'glass', at: [3.8, -1.2] },
  { name: 'millefeuille', at: [6, 1] },
];

/** The camera's path and where it looks along it, from the start of the scroll to its end. */
const PATH = new CatmullRomCurve3([new Vector3(-6.5, 4.6, 4.2), new Vector3(-3.5, 2.6, 4.2), new Vector3(0, 2.1, 4), new Vector3(3.4, 2.3, 4.2), new Vector3(7.5, 3.8, 4.6)]);
const LOOK = new CatmullRomCurve3([new Vector3(-3.2, 0.2, 1.2), new Vector3(-1, 0.3, -0.4), new Vector3(1.6, 0.4, 0.4), new Vector3(3.8, 0.4, -0.6), new Vector3(6, 0.3, 0.6)]);

/** Wood: warm stripes of grain on a walnut ground. */
function woodTexture() {
  const texture = drawnTexture(
    512,
    512,
    (ctx, w, h) => {
      ctx.fillStyle = '#3a2416';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const y = hash(i, 1) * h;
        ctx.strokeStyle = `rgba(${120 + hash(i, 2) * 60}, ${70 + hash(i, 3) * 40}, ${35 + hash(i, 4) * 20}, ${0.12 + hash(i, 5) * 0.18})`;
        ctx.lineWidth = 1 + hash(i, 6) * 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6);
        ctx.stroke();
      }
    },
    true,
  );
  texture.repeat.set(3, 2);
  return texture;
}

/**
 * #26 The scroll moves the camera over a table laid with dishes: it starts high over the first cup, swoops low along
 * the table and rises at the far end, looking ahead along its path. Scrolling back flies the same path in reverse.
 */
export default glMotion((renderer) => {
  const { scene, camera } = studioScene(renderer, { fov: 38 });
  const table = new Mesh(new PlaneGeometry(22, 9), new MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 }));
  table.rotation.x = -Math.PI / 2;
  table.position.set(1.4, -0.125, 0);
  scene.add(table);
  for (const { name, at } of TABLE) {
    const place = new Group();
    place.add(buildDish(name).group, buildPlinth(DISH_FRAMING[name].plinth * 0.8));
    place.position.set(at[0], 0, at[1]);
    place.rotation.y = at[0] * 0.6;
    scene.add(place);
  }
  const eye = new Vector3();
  const look = new Vector3();
  return {
    scene,
    camera,
    update(frame) {
      const p = easeInOutCubic(frame.progress);
      PATH.getPointAt(p, eye);
      LOOK.getPointAt(p, look);
      camera.position.copy(eye);
      camera.lookAt(look);
    },
    dispose: () => disposeObject(scene),
  };
});
