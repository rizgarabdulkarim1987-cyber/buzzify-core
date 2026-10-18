'use client';

import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, MeshPhysicalMaterial, Vector3 } from 'three';
import { glMotion } from '../engine/define';
import { disposeObject, studioScene } from '../engine/dish';
import { easeInOutCubic, easeOutCubic, hash, TAU } from '../engine/math';
import { num, str } from '../types';

/** One cycle: whole, bursting, adrift, coming back (seconds). */
const PHASES = [1.6, 0.9, 1.3, 1.5] as const;
const CYCLE = PHASES.reduce((a, b) => a + b, 0);

function apart(t: number): number {
  const local = t % CYCLE;
  if (local < PHASES[0]) return 0;
  if (local < PHASES[0] + PHASES[1]) return easeOutCubic((local - PHASES[0]) / PHASES[1]);
  if (local < PHASES[0] + PHASES[1] + PHASES[2]) return 1 + ((local - PHASES[0] - PHASES[1]) / PHASES[2]) * 0.15;
  return 1.15 * (1 - easeInOutCubic((local - PHASES[0] - PHASES[1] - PHASES[2]) / PHASES[3]));
}

/** #12 A faceted gold gem that bursts into its facets, drifts, and pulls itself back together. */
export default glMotion((renderer, params) => {
  const { scene, camera } = studioScene(renderer, { fov: 30, environmentIntensity: 1.3 });
  const gem = new IcosahedronGeometry(1, 1).toNonIndexed();
  const positions = gem.attributes.position!.array as Float32Array;
  const material = new MeshPhysicalMaterial({ color: str(params, 'color'), metalness: 1, roughness: 0.22, flatShading: true, side: DoubleSide, clearcoat: 0.5 });
  const group = new Group();
  const shards: Array<{ mesh: Mesh; centre: Vector3; axis: Vector3; reach: number; turn: number }> = [];
  for (let f = 0; f < positions.length / 9; f++) {
    const centre = new Vector3();
    const corners = [0, 1, 2].map((c) => new Vector3(positions[f * 9 + c * 3]!, positions[f * 9 + c * 3 + 1]!, positions[f * 9 + c * 3 + 2]!));
    corners.forEach((corner) => centre.add(corner));
    centre.divideScalar(3);
    const local = new BufferGeometry();
    local.setAttribute('position', new Float32BufferAttribute(corners.flatMap((corner) => corner.clone().sub(centre).toArray()), 3));
    local.computeVertexNormals();
    const mesh = new Mesh(local, material);
    mesh.position.copy(centre);
    group.add(mesh);
    shards.push({
      mesh,
      centre,
      axis: new Vector3(hash(f, 1) - 0.5, hash(f, 2) - 0.5, hash(f, 3) - 0.5).normalize(),
      reach: 1.6 + hash(f, 4) * 1.6,
      turn: (0.6 + hash(f, 5)) * TAU,
    });
  }
  gem.dispose();
  scene.add(group);
  camera.position.set(0, 0.3, 7);
  camera.lookAt(0, 0, 0);
  return {
    scene,
    camera,
    update(frame) {
      const a = apart(frame.t) * num(frame.params, 'spread');
      material.color.set(String(frame.params.color));
      for (const shard of shards) {
        shard.mesh.position.copy(shard.centre).multiplyScalar(1 + a * shard.reach);
        shard.mesh.setRotationFromAxisAngle(shard.axis, a * shard.turn);
      }
      group.rotation.set(0.3, frame.t * 0.3, 0);
    },
    dispose: () => disposeObject(scene),
  };
}, { still: 3.2 });
