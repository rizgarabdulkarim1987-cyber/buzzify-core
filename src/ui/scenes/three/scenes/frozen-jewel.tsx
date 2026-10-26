'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshPhysicalMaterial, OctahedronGeometry, type DirectionalLight, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 30 Frozen Jewel: faceted crystal sculptures in plum and lilac, turning slowly. Between categories the light changes,
 * from a cool lilac key to a warm pearl one and on, eased; a tap turns the nearest crystal a facet further; scrolling
 * tilts them toward the light.
 */

const CRYSTALS = [
  { x: 0.76, y: 0.5, z: -0.6, s: [0.7, 1.25, 0.7] as const },
  { x: -0.78, y: -0.2, z: -1.6, s: [0.55, 0.95, 0.55] as const },
  { x: 0.6, y: -0.72, z: 0.1, s: [0.42, 0.75, 0.42] as const },
];
const LIGHTS = ['#C9B3E0', '#FFF2E6', '#A9B8E6', '#F2C9E0'];

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const crystals = useRef<Array<Group | null>>([]);
  const key = useRef<DirectionalLight>(null);
  const turns = useRef(CRYSTALS.map(() => 0));
  const geometry = useMemo(() => new OctahedronGeometry(1, 0), []);
  const crystal = useMemo(
    () =>
      low
        ? new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.08, metalness: 0.1, flatShading: true, clearcoat: 1, iridescence: 0.6 })
        : new MeshPhysicalMaterial({ color: colors.accent.clone().lerp(new Color('#ffffff'), 0.25), roughness: 0.05, transmission: 0.85, thickness: 1, ior: 1.6, flatShading: true, iridescence: 0.8, iridescenceIOR: 1.5 }),
    [colors.accent, low],
  );
  const lights = useMemo(() => LIGHTS.map((hex) => new Color(hex)), []);
  const lightColor = useMemo(() => new Color(LIGHTS[0]), []);
  useEffect(
    () => () => {
      geometry.dispose();
      crystal.dispose();
    },
    [geometry, crystal],
  );

  useFrame((_, delta) => {
    const target = lights[clock.category % lights.length]!;
    lightColor.lerp(target, 1 - Math.exp(-Math.min(delta, 1 / 20) * 1.5));
    if (key.current) {
      key.current.color.copy(lightColor);
      const a = clock.category * 1.1;
      key.current.position.x = approach(key.current.position.x, Math.cos(a) * 6, 1.5, delta);
      key.current.position.z = approach(key.current.position.z, 4 + Math.sin(a) * 2, 1.5, delta);
    }
    CRYSTALS.forEach((item, i) => {
      const group = crystals.current[i];
      if (!group) return;
      const x = item.x * (viewport.width / 2);
      const y = item.y * (viewport.height / 2);
      const near = Math.exp(-((clock.tap.x - x) ** 2 + (clock.tap.y - y) ** 2) / 2);
      turns.current[i] = approach(turns.current[i]!, turns.current[i]! + clock.tapPulse * near * 1.2, 5, delta);
      group.position.set(x, y + Math.sin(clock.t * 0.5 + i) * 0.06, item.z);
      group.rotation.set(clock.progress * 0.6 * (i % 2 ? -1 : 1), clock.t * 0.15 * (i % 2 ? -1 : 1) + turns.current[i]!, 0.15);
    });
  });

  return (
    <>
      <ambientLight intensity={0.25} color={colors.accent} />
      <directionalLight ref={key} position={[6, 5, 4]} intensity={2.6} />
      <directionalLight position={[-5, -2, 3]} intensity={0.5} color={colors.accent} />
      {CRYSTALS.map((item, i) => (
        <group
          key={i}
          ref={(node) => {
            crystals.current[i] = node;
          }}
          scale={item.s as unknown as [number, number, number]}
        >
          <mesh geometry={geometry} material={crystal} />
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 1 };
export default scene;
