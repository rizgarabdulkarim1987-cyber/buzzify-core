'use client';

import { Mesh, MeshPhysicalMaterial, SphereGeometry, Vector3 } from 'three';
import { glMotion } from '../engine/define';
import { disposeObject, studioScene } from '../engine/dish';
import { breathe, smoothstep } from '../engine/math';
import { str } from '../types';

type Shape = 'ring' | 'drop' | 'pill';

/**
 * Where a point of the unit sphere goes in the target shape, found from its direction: around the vertical axis
 * (`u`) and down from the top (`phi`), so every shape is reached by the same vertices and the morph is a straight
 * blend between two positions.
 */
function target(shape: Shape, direction: Vector3, out: Vector3): Vector3 {
  const u = Math.atan2(direction.z, direction.x);
  const phi = Math.acos(Math.max(-1, Math.min(1, direction.y)));
  switch (shape) {
    case 'ring': {
      const tube = 2 * phi - Math.PI / 2;
      const R = 0.82;
      const r = 0.34;
      return out.set((R + r * Math.cos(tube)) * Math.cos(u), r * Math.sin(tube), (R + r * Math.cos(tube)) * Math.sin(u));
    }
    case 'drop': {
      // A teardrop: a point at the top, a full round bottom.
      const radius = Math.sin(phi) * (0.35 + 0.65 * Math.sin(phi / 2) ** 1.6) * 1.05;
      return out.set(radius * Math.cos(u), Math.cos(phi) * 1.25 + 0.15, radius * Math.sin(u));
    }
    case 'pill': {
      const lift = direction.y >= 0 ? 0.55 : -0.55;
      return out.set(direction.x * 0.62, direction.y * 0.62 + lift, direction.z * 0.62).applyAxisAngle(new Vector3(0, 0, 1), Math.PI / 5);
    }
  }
}

/** #7 A gold sphere that flows into another shape and back, rippling as it changes. */
export default glMotion(
  (renderer, params) => {
    const { scene, camera } = studioScene(renderer, { fov: 30 });
    const geometry = new SphereGeometry(1, 160, 110);
    const position = geometry.attributes.position!;
    const from = Float32Array.from(position.array as Float32Array);
    const to = new Float32Array(from.length);
    const direction = new Vector3();
    const point = new Vector3();
    const shape = str(params, 'shape') as Shape;
    for (let i = 0; i < position.count; i++) {
      direction.set(from[i * 3]!, from[i * 3 + 1]!, from[i * 3 + 2]!).normalize();
      target(shape, direction, point);
      to.set([point.x, point.y, point.z], i * 3);
    }
    const material = new MeshPhysicalMaterial({ color: str(params, 'color'), metalness: 1, roughness: 0.16, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 1.4 });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);
    camera.position.set(0, 0.6, 5.6);
    camera.lookAt(0, 0, 0);
    const array = position.array as Float32Array;
    return {
      scene,
      camera,
      update(frame) {
        // 0 = sphere, 1 = the shape, with a moment held at each end.
        const m = smoothstep(0.12, 0.88, breathe(frame.t / 6));
        const ripple = Math.sin(m * Math.PI) * 0.06;
        for (let i = 0; i < position.count; i++) {
          const k = i * 3;
          const x = from[k]! + (to[k]! - from[k]!) * m;
          const y = from[k + 1]! + (to[k + 1]! - from[k + 1]!) * m;
          const z = from[k + 2]! + (to[k + 2]! - from[k + 2]!) * m;
          const wave = 1 + ripple * Math.sin(y * 7 + frame.t * 3 + Math.atan2(z, x) * 3);
          array[k] = x * wave;
          array[k + 1] = y * wave;
          array[k + 2] = z * wave;
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        material.color.set(String(frame.params.color));
        mesh.rotation.set(0.35, frame.t * 0.35, 0);
      },
      dispose: () => disposeObject(scene),
    };
  },
  { rebuild: ['shape'], still: 2.4 },
);
