'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshPhysicalMaterial, SphereGeometry, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 24 Pistachio Boutique: sculptures of pistachios, a half-open shell showing its green kernel, enlarged and polished
 * like confectionery. Choosing a category turns each one a little further; a tap spins the nearest; scrolling lifts
 * them.
 */

const NUTS = [
  { x: 0.78, y: 0.55, z: -0.4, s: 0.85 },
  { x: -0.8, y: 0.05, z: -1.4, s: 0.65 },
  { x: 0.68, y: -0.7, z: 0.1, s: 0.55 },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const nuts = useRef<Array<Group | null>>([]);
  const turns = useRef(NUTS.map(() => 0));
  const spins = useRef(NUTS.map(() => 0));
  const shell = useMemo(() => new SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.62), []);
  const shellMaterial = useMemo(() => new MeshPhysicalMaterial({ color: new Color('#E8D8BC').lerp(colors.raised, 0.3), roughness: 0.4, clearcoat: 0.7, side: 2 }), [colors.raised]);
  const kernel = useMemo(() => new MeshPhysicalMaterial({ color: new Color('#93AE6A').lerp(colors.accent, 0.15), roughness: 0.45, clearcoat: 0.5 }), [colors.accent]);
  const skin = useMemo(() => new MeshPhysicalMaterial({ color: colors.button, roughness: 0.5, clearcoat: 0.3 }), [colors.button]);
  useEffect(
    () => () => {
      shell.dispose();
      shellMaterial.dispose();
      kernel.dispose();
      skin.dispose();
    },
    [shell, shellMaterial, kernel, skin],
  );

  useFrame((_, delta) => {
    NUTS.forEach((nut, i) => {
      const group = nuts.current[i];
      if (!group) return;
      const x = nut.x * (viewport.width / 2);
      const y = nut.y * (viewport.height / 2) + clock.progress * 0.8;
      const near = Math.exp(-((clock.tap.x - x) ** 2 + (clock.tap.y - y) ** 2) / 2);
      spins.current[i] = approach(spins.current[i]!, spins.current[i]! + clock.tapPulse * near * 2, 5, delta);
      turns.current[i] = approach(turns.current[i]!, clock.category * 0.8 * (i % 2 ? -1 : 1), 2.2, delta);
      group.position.set(x, y + Math.sin(clock.t * 0.6 + i) * 0.06, nut.z);
      group.rotation.set(0.4 + Math.sin(clock.t * 0.3 + i) * 0.1, turns.current[i]! + spins.current[i]! + clock.t * 0.12, 0.3 * (i - 1));
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1]} />
      <directionalLight position={[4, 6, 5]} intensity={1.8} color="#fff6e4" />
      {NUTS.map((nut, i) => (
        <group
          key={i}
          ref={(node) => {
            nuts.current[i] = node;
          }}
          scale={nut.s}
        >
          <mesh geometry={shell} material={shellMaterial} scale={[0.75, 1.2, 0.75]} position={[0, -0.05, 0]} rotation={[0.35, 0, 0]} />
          <mesh geometry={shell} material={shellMaterial} scale={[0.75, 1.2, 0.75]} position={[0, -0.05, 0]} rotation={[Math.PI - 0.35, 0, 0]} />
          <mesh material={kernel} scale={[0.55, 1.02, 0.5]}>
            <sphereGeometry args={[1, 32, 24]} />
          </mesh>
          <mesh material={skin} scale={[0.57, 0.6, 0.52]} position={[0, -0.45, 0]}>
            <sphereGeometry args={[1, 24, 16]} />
          </mesh>
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 0.9 };
export default scene;
