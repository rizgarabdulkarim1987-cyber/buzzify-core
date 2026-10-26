'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MeshPhysicalMaterial, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { blobGeometry, displaceBlob } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 12 Cream Studio: soft, milky forms resting at the edges, their surfaces slowly shifting like poured cream. A tap makes
 * the nearest form swell gently; scrolling lets them slide past each other.
 */

const BLOBS = [
  { x: 0.9, y: 0.72, z: -1, s: 1.15, tint: 'raised' as const },
  { x: -0.95, y: -0.55, z: -1.6, s: 1.35, tint: 'raised' as const },
  { x: 0.82, y: -0.2, z: 0.2, s: 0.42, tint: 'accent' as const },
];

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const meshes = useRef<Array<Mesh | null>>([]);
  const swell = useRef(BLOBS.map(() => 0));
  const geometries = useMemo(() => BLOBS.map(() => blobGeometry(low ? 4 : 5)), [low]);
  const bases = useMemo(() => geometries.map((geometry) => Float32Array.from(geometry.attributes.position!.array as Float32Array)), [geometries]);
  const materials = useMemo(
    () => BLOBS.map((blob) => new MeshPhysicalMaterial({ color: blob.tint === 'accent' ? colors.accent : colors.raised.clone().lerp(colors.card, 0.4), roughness: 0.55, sheen: 0.6, sheenColor: colors.card })),
    [colors.accent, colors.raised, colors.card],
  );
  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
    [geometries, materials],
  );

  useFrame((_, delta) => {
    BLOBS.forEach((blob, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const x = blob.x * (viewport.width / 2) + (i % 2 ? -1 : 1) * clock.progress * 0.5;
      const y = blob.y * (viewport.height / 2) + clock.progress * (i % 2 ? 0.8 : -0.6);
      const near = Math.exp(-((clock.tap.x - x) ** 2 + (clock.tap.y - y) ** 2) / 3);
      swell.current[i] = approach(swell.current[i]!, clock.tapPulse * near, 4, delta);
      displaceBlob(geometries[i]!, bases[i]!, clock.t * 0.6 + i * 3, 0.14 + swell.current[i]! * 0.12);
      mesh.position.set(x, y, blob.z);
      mesh.scale.setScalar(blob.s * (1 + swell.current[i]! * 0.08));
      mesh.rotation.y = clock.t * 0.05 + i;
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.raised, 1.3]} />
      <directionalLight position={[4, 6, 5]} intensity={1.4} />
      {BLOBS.map((blob, i) => (
        <mesh
          key={i}
          ref={(node) => {
            meshes.current[i] = node;
          }}
          geometry={geometries[i]}
          material={materials[i]}
        />
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 0.7 };
export default scene;
