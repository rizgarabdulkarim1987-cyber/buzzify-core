'use client';

import { AdditiveBlending, BufferGeometry, CircleGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PlaneGeometry, Points, PointsMaterial } from 'three';
import { softDotTexture } from '@/ui/stage/materials';
import { glMotion } from '../engine/define';
import { buildDish, DISH_FRAMING, disposeObject, frameDish, studioScene, type DishName } from '../engine/dish';
import { easeInOutCubic, hash, lerp } from '../engine/math';
import { bool, str } from '../types';

const SHOT = 9;

/**
 * #31 A product shot as a film would light it: the dish stands on black glass that mirrors it, dust drifts in the key
 * light, a hard gold rim traces its edge, and the camera pushes in slowly over nine seconds. Cinema bars frame it.
 */
export default glMotion(
  (renderer, params) => {
    const name = str(params, 'model') as DishName;
    const base = studioScene(renderer, { fov: 28, environmentIntensity: 0.55 });
    const { scene, camera, key, rim } = base;
    key.intensity = 1.6;
    key.position.set(-2.4, 4.2, 2.2);
    rim.intensity = 5;
    rim.position.set(2.2, 1.6, -3.4);
    const dish = buildDish(name);
    scene.add(dish.group);
    // The mirror image under the glass floor: the dish upside down, seen through a dark, slightly clear floor.
    const reflection = dish.group.clone();
    reflection.scale.y = -1;
    scene.add(reflection);
    const floor = new Mesh(
      new CircleGeometry(9, 64),
      new MeshPhysicalMaterial({ color: '#050403', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.8, clearcoat: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const dustCount = 160;
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) positions.set([lerp(-3, 3, hash(i, 1)), lerp(0.1, 3.2, hash(i, 2)), lerp(-2.5, 2, hash(i, 3))], i * 3);
    const dustGeometry = new BufferGeometry();
    dustGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const dust = new Points(dustGeometry, new PointsMaterial({ map: softDotTexture(), size: 0.035, color: '#ffe9c4', transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending }));
    scene.add(dust);
    // Cinema bars ride on the camera, sized to the frame in `resize`.
    scene.add(camera);
    // Transparent so they draw after the see-through floor, which would otherwise cover the lower bar.
    const barMaterial = new MeshBasicMaterial({ color: '#000000', depthTest: false, transparent: true });
    const bars = [new Mesh(new PlaneGeometry(1, 1), barMaterial), new Mesh(new PlaneGeometry(1, 1), barMaterial)];
    bars.forEach((bar) => {
      bar.renderOrder = 10;
      camera.add(bar);
    });
    const framing = { distance: 6, lift: 1.6, target: 0.4 };
    return {
      scene,
      camera,
      resize() {
        Object.assign(framing, frameDish(camera, name, dish.height, 1.05));
        const halfH = Math.tan((camera.fov * Math.PI) / 360);
        const halfW = halfH * camera.aspect;
        bars.forEach((bar, i) => {
          bar.scale.set(halfW * 2.2, halfH * 0.24, 1);
          bar.position.set(0, (i === 0 ? 1 : -1) * halfH * 0.89, -1);
        });
      },
      update(frame) {
        const shot = easeInOutCubic((frame.t % SHOT) / SHOT);
        const distance = lerp(framing.distance * 1.35, framing.distance * 0.82, shot);
        const angle = lerp(-0.35, 0.3, shot);
        camera.position.set(Math.sin(angle) * distance, lerp(framing.lift * 0.7, framing.lift * 0.55, shot), Math.cos(angle) * distance);
        camera.lookAt(0, framing.target + DISH_FRAMING[name].aim * 0.5, 0);
        bars.forEach((bar) => (bar.visible = bool(frame.params, 'letterbox')));
        for (let i = 0; i < dustCount; i++) {
          positions[i * 3 + 1] = lerp(0.1, 3.2, (hash(i, 2) + frame.t * 0.012 * (0.5 + hash(i, 4))) % 1);
          positions[i * 3] = lerp(-3, 3, hash(i, 1)) + Math.sin(frame.t * 0.3 + i) * 0.05;
        }
        dustGeometry.attributes.position!.needsUpdate = true;
      },
      dispose: () => disposeObject(scene),
    };
  },
  { rebuild: ['model'], still: 6 },
);
