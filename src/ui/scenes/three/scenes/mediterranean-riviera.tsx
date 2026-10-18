'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Group } from 'three';
import { useSceneClock, usePaletteColors } from '../kit/clock';
import { curledGeometry, leafShape } from '../kit/shapes';
import { WaterSurface } from '../kit/water';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 06 Mediterranean Riviera: a sunlit lagoon seen from above. Caustic light drifts across the water; a tap sends rings
 * across it; lemons with their leaves bob at the edges; scrolling moves the sun's light along.
 */

const LEMONS = [
  { x: 0.82, y: 0.7, s: 0.42, r: 0.3 },
  { x: -0.86, y: 0.15, s: 0.36, r: -0.6 },
  { x: 0.76, y: -0.62, s: 0.32, r: 1.1 },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const lemons = useRef<Array<Group | null>>([]);
  const lemon = useMemo(() => new MeshPhysicalMaterial({ color: new Color('#E7CB65'), roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 }), []);
  const leafGeometry = useMemo(() => curledGeometry(leafShape(0.9, 0.34), 0.25, 0.3), []);
  const leaf = useMemo(() => new MeshStandardMaterial({ color: new Color('#5E7F4A'), roughness: 0.6, side: 2 }), []);
  const deep = useMemo(() => colors.accent.clone().lerp(colors.bg, 0.15), [colors.accent, colors.bg]);
  const shallow = useMemo(() => colors.accent.clone().lerp(colors.bg, 0.7), [colors.accent, colors.bg]);
  const light = useMemo(() => new Color('#FFF6D0'), []);
  useEffect(
    () => () => {
      lemon.dispose();
      leafGeometry.dispose();
      leaf.dispose();
    },
    [lemon, leafGeometry, leaf],
  );

  useFrame(() => {
    LEMONS.forEach((item, i) => {
      const group = lemons.current[i];
      if (!group) return;
      group.position.set(item.x * (viewport.width / 2), item.y * (viewport.height / 2) + Math.sin(clock.t * 0.9 + i * 2) * 0.05, 0.5);
      group.rotation.set(Math.sin(clock.t * 0.7 + i) * 0.12, clock.t * 0.15 + item.r, Math.sin(clock.t * 0.5 + i) * 0.1);
    });
  });

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 6]} intensity={2.2} color="#fff3d6" />
      <WaterSurface deep={deep} shallow={shallow} light={light} opacity={0.55} position={[0, 0, -3]} />
      {LEMONS.map((item, i) => (
        <group
          key={i}
          ref={(node) => {
            lemons.current[i] = node;
          }}
          scale={item.s}
        >
          <mesh material={lemon} scale={[1, 0.78, 0.78]}>
            <sphereGeometry args={[1, 40, 28]} />
          </mesh>
          <mesh material={lemon} position={[1.02, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.16, 0.22, 16]} />
          </mesh>
          <mesh geometry={leafGeometry} material={leaf} position={[-0.6, 0.55, 0.2]} rotation={[0.3, 0.2, 0.9]} />
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 1 };
export default scene;
