'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshPhysicalMaterial, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 27 Sorbet Garden: fruit drifting at the edges of the page: a citrus wheel, raspberries, a mango cheek and a mint leaf
 * pair, glossy like sorbet. Choosing a category sends them on a short loop; a tap pushes the nearest fruit away and it
 * drifts back; scrolling carries them up slowly.
 */

type Fruit = 'citrus' | 'berry' | 'mango' | 'mint';
const FRUITS: Array<{ kind: Fruit; x: number; y: number; z: number; s: number }> = [
  { kind: 'citrus', x: 0.82, y: 0.66, z: -0.4, s: 0.55 },
  { kind: 'berry', x: -0.84, y: 0.32, z: -1, s: 0.42 },
  { kind: 'mango', x: 0.74, y: -0.28, z: -1.4, s: 0.5 },
  { kind: 'mint', x: -0.78, y: -0.72, z: 0.1, s: 0.5 },
  { kind: 'berry', x: 0.62, y: -0.84, z: 0.3, s: 0.32 },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const fruits = useRef<Array<Group | null>>([]);
  const offsets = useRef(FRUITS.map(() => ({ x: 0, y: 0 })));
  const loop = useRef(0);
  const materials = useMemo(
    () => ({
      peel: new MeshPhysicalMaterial({ color: new Color('#E7B15C'), roughness: 0.4, clearcoat: 0.6 }),
      flesh: new MeshPhysicalMaterial({ color: new Color('#F4D27C'), roughness: 0.3, transmission: 0.2, clearcoat: 0.8 }),
      berry: new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.35, clearcoat: 0.9 }),
      mango: new MeshPhysicalMaterial({ color: new Color('#E9A84A'), roughness: 0.35, clearcoat: 0.8 }),
      mint: new MeshPhysicalMaterial({ color: new Color('#7FAF7A'), roughness: 0.5, side: 2 }),
    }),
    [colors.accent],
  );
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);

  useFrame((_, delta) => {
    loop.current = approach(loop.current, clock.categoryPulse, 3, delta);
    FRUITS.forEach((fruit, i) => {
      const group = fruits.current[i];
      if (!group) return;
      const x = fruit.x * (viewport.width / 2);
      const y = fruit.y * (viewport.height / 2) + clock.progress * 0.7;
      const offset = offsets.current[i]!;
      const dx = x - clock.tap.x;
      const dy = y - clock.tap.y;
      const reach = Math.exp(-(dx * dx + dy * dy) / 2) * clock.tapPulse;
      offset.x = approach(offset.x, dx * reach * 0.8, 3, delta);
      offset.y = approach(offset.y, dy * reach * 0.8, 3, delta);
      const a = loop.current * Math.PI * 2 + i;
      group.position.set(x + offset.x + Math.cos(a) * loop.current * 0.25, y + offset.y + Math.sin(a) * loop.current * 0.25 + Math.sin(clock.t * 0.7 + i) * 0.06, fruit.z);
      group.rotation.set(Math.sin(clock.t * 0.4 + i) * 0.3, clock.t * 0.2 + i, 0.2 * i);
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1.1]} />
      <directionalLight position={[4, 6, 5]} intensity={1.8} />
      {FRUITS.map((fruit, i) => (
        <group
          key={i}
          ref={(node) => {
            fruits.current[i] = node;
          }}
          scale={fruit.s}
        >
          {fruit.kind === 'citrus' && (
            <>
              <mesh material={materials.peel} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[1, 1, 0.22, 48]} />
              </mesh>
              {Array.from({ length: 8 }, (_, s) => (
                <mesh key={s} material={materials.flesh} position={[Math.cos((s / 8) * Math.PI * 2) * 0.5, Math.sin((s / 8) * Math.PI * 2) * 0.5, 0.12]} rotation={[0, 0, (s / 8) * Math.PI * 2]} scale={[0.42, 0.2, 0.05]}>
                  <sphereGeometry args={[1, 16, 10]} />
                </mesh>
              ))}
            </>
          )}
          {fruit.kind === 'berry' &&
            Array.from({ length: 12 }, (_, d) => {
              const phi = Math.acos(1 - (2 * (d + 0.5)) / 12);
              const theta = Math.PI * (1 + Math.sqrt(5)) * d;
              return (
                <mesh key={d} material={materials.berry} position={[Math.cos(theta) * Math.sin(phi) * 0.6, Math.cos(phi) * 0.7, Math.sin(theta) * Math.sin(phi) * 0.6]}>
                  <sphereGeometry args={[0.32, 16, 12]} />
                </mesh>
              );
            })}
          {fruit.kind === 'mango' && (
            <mesh material={materials.mango} scale={[1, 0.72, 0.5]}>
              <sphereGeometry args={[1, 40, 28]} />
            </mesh>
          )}
          {fruit.kind === 'mint' &&
            [-0.5, 0.5].map((tilt) => (
              <mesh key={tilt} material={materials.mint} rotation={[0.2, 0, tilt]} scale={[0.5, 1, 0.12]}>
                <sphereGeometry args={[1, 24, 16]} />
              </mesh>
            ))}
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 1 };
export default scene;
