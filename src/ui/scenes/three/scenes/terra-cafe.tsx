'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { ExtrudeGeometry, MeshPhysicalMaterial, MeshStandardMaterial, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { archShape, latheOf, PROFILES } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 15 Terra Café: clay. Terracotta vessels stand in front of plastered arches that recede in depth; scrolling moves the
 * camera through the arches (and back), the vessels passing at their own depths; a tap turns the vessels.
 */

const VESSELS = [
  { x: -0.86, y: -0.82, z: 0.4, s: 0.85, profile: PROFILES.vase },
  { x: 0.84, y: -0.78, z: -0.6, s: 1.1, profile: PROFILES.amphora },
  { x: 0.7, y: 0.5, z: -3.4, s: 0.9, profile: PROFILES.vase },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const vessels = useRef<Array<Group | null>>([]);
  const spin = useRef(0);
  const geometries = useMemo(() => VESSELS.map((vessel) => latheOf(vessel.profile)), []);
  const clay = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.82, sheen: 0.3, sheenColor: colors.raised }), [colors.accent, colors.raised]);
  const arch = useMemo(() => new ExtrudeGeometry(archShape(3, 4.6, 0.32), { depth: 0.5, bevelEnabled: false, curveSegments: 40 }), []);
  const plaster = useMemo(() => new MeshStandardMaterial({ color: colors.raised.clone().lerp(colors.card, 0.3), roughness: 0.95 }), [colors.raised, colors.card]);
  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose());
      clay.dispose();
      arch.dispose();
      plaster.dispose();
    },
    [geometries, clay, arch, plaster],
  );

  useFrame(({ camera }, delta) => {
    camera.position.z = approach(camera.position.z, 9 - clock.progress * 6, 3, delta);
    spin.current = approach(spin.current, spin.current + clock.tapPulse * 0.4, 6, delta);
    VESSELS.forEach((vessel, i) => {
      const group = vessels.current[i];
      if (!group) return;
      group.position.set(vessel.x * (viewport.width / 2), vessel.y * (viewport.height / 2), vessel.z);
      group.rotation.y = clock.t * 0.12 * (i % 2 ? -1 : 1) + spin.current;
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 0.9]} />
      <directionalLight position={[5, 6, 4]} intensity={2} color="#ffe2c4" />
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={arch} material={plaster} position={[i % 2 ? 0.8 : -0.8, -3.3, -2 - i * 3]} />
      ))}
      {VESSELS.map((vessel, i) => (
        <group
          key={i}
          ref={(node) => {
            vessels.current[i] = node;
          }}
          scale={vessel.s}
        >
          <mesh geometry={geometries[i]} material={clay} />
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 9], fov: 40 }, environment: 0.7 };
export default scene;
