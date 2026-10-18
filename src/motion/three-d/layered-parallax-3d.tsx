'use client';

import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type Texture } from 'three';
import { mix, shade } from '../engine/color';
import { glMotion } from '../engine/define';
import { buildDish, disposeObject, studioScene } from '../engine/dish';
import { damp, hash, TAU } from '../engine/math';
import { drawnTexture } from '../engine/textures';
import { num, str } from '../types';

/** A frame of the layered menu card: an outline in the accent colour, with a different ornament at each depth. */
function frameTexture(accent: string, background: string, layer: number): Texture {
  return drawnTexture(512, 640, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    if (layer === 0) {
      ctx.fillStyle = shade(background, 0.06);
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 26);
      ctx.fill();
    }
    ctx.strokeStyle = layer === 0 ? mix(accent, background, 0.5) : accent;
    ctx.lineWidth = layer === 0 ? 3 : 5;
    ctx.beginPath();
    if (layer === 1) {
      // An arch.
      ctx.moveTo(70, h - 60);
      ctx.lineTo(70, 260);
      ctx.arc(w / 2, 260, w / 2 - 70, Math.PI, 0);
      ctx.lineTo(w - 70, h - 60);
    } else {
      ctx.roundRect(26 + layer * 20, 26 + layer * 20, w - 52 - layer * 40, h - 52 - layer * 40, 18);
    }
    ctx.stroke();
    if (layer === 0) {
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 18; i++) {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 40 + i * 14, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  });
}

/**
 * #11 A menu card built in layers of depth: a back panel, an arch, a dish and gold flecks in front. The pointer tilts
 * the whole stack, so near layers travel further than far ones. Without a pointer it sways on its own.
 */
export default glMotion((renderer, params) => {
  const { scene, camera } = studioScene(renderer, { fov: 32 });
  const accent = str(params, 'color');
  const background = str(params, 'background');
  const depth = num(params, 'depth');
  const stack = new Group();
  scene.add(stack);
  const plane = new PlaneGeometry(2.4, 3);
  [0, 1, 2].forEach((layer) => {
    const material = new MeshBasicMaterial({ map: frameTexture(accent, background, layer), transparent: true, depthWrite: false });
    const mesh = new Mesh(plane, material);
    mesh.position.z = (-1.4 + layer * 0.55) * depth;
    mesh.scale.setScalar(1 - layer * 0.06);
    mesh.renderOrder = layer;
    stack.add(mesh);
  });
  const dish = buildDish('croissant');
  dish.group.scale.setScalar(0.62);
  dish.group.position.set(0, -0.45, 0.25 * depth);
  dish.group.rotation.x = 0.5;
  stack.add(dish.group);
  const fleck = new PlaneGeometry(0.07, 0.07);
  const gold = new MeshStandardMaterial({ color: accent, metalness: 1, roughness: 0.25 });
  for (let i = 0; i < 26; i++) {
    const m = new Mesh(fleck, gold);
    m.position.set((hash(i, 1) - 0.5) * 3, (hash(i, 2) - 0.5) * 3.4, (0.7 + hash(i, 3) * 0.8) * depth);
    m.rotation.set(hash(i, 4) * TAU, hash(i, 5) * TAU, 0);
    m.userData.phase = hash(i, 6) * TAU;
    stack.add(m);
  }
  camera.position.set(0, 0, 7.4);
  camera.lookAt(0, 0, 0);
  const tilt = { x: 0, y: 0 };
  return {
    scene,
    camera,
    update(frame) {
      const px = frame.width ? frame.pointer.x / frame.width - 0.5 : 0;
      const py = frame.height ? frame.pointer.y / frame.height - 0.5 : 0;
      const dt = frame.dt || 1;
      tilt.y = damp(tilt.y, px * 0.7, 5, dt);
      tilt.x = damp(tilt.x, py * 0.5, 5, dt);
      stack.rotation.set(tilt.x, tilt.y, 0);
      dish.group.rotation.y = frame.t * 0.4;
      stack.children.forEach((child) => {
        if (typeof child.userData.phase === 'number') child.rotation.z = frame.t + child.userData.phase;
      });
    },
    dispose: () => disposeObject(scene),
  };
}, { rebuild: ['color', 'background', 'depth'] });
