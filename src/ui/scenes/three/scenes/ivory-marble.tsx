'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MeshPhysicalMaterial, MeshStandardMaterial, type Group } from 'three';
import { shadowTexture } from '@/ui/stage/materials';
import { useSceneClock, usePaletteColors } from '../kit/clock';
import { marbleTexture } from '../kit/textures';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 02 Ivory Marble: marble pedestals in a bright gallery, each holding a bronze sculpture. The camera drifts slowly
 * between them and rises along them as the page scrolls; a tap turns the sculptures.
 */

const PEDESTALS: Array<{ x: number; z: number; h: number; r: number; side: -1 | 1; shape: 'sphere' | 'torus' | 'cone' }> = [
  { x: 0.92, z: -0.5, h: 2.6, r: 0.42, side: -1, shape: 'sphere' },
  { x: 0.95, z: 0.6, h: 1.7, r: 0.36, side: 1, shape: 'torus' },
  { x: 0.7, z: -3, h: 3.2, r: 0.5, side: 1, shape: 'cone' },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const rig = useRef<Group>(null);
  const viewport = useThree((state) => state.viewport);
  const sculptures = useRef<Array<Group | null>>([]);
  const marble = useMemo(() => marbleTexture(palette.card, palette.muted, 11), [palette.card, palette.muted]);
  const stone = useMemo(() => new MeshStandardMaterial({ map: marble, roughness: 0.32, metalness: 0 }), [marble]);
  const bronze = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, metalness: 0.9, roughness: 0.3, clearcoat: 0.4 }), [colors.accent]);
  const shadow = useMemo(() => shadowTexture(), []);
  useEffect(
    () => () => {
      marble.dispose();
      stone.dispose();
      bronze.dispose();
      shadow.dispose();
    },
    [marble, stone, bronze, shadow],
  );

  useFrame(({ camera }) => {
    const p = clock.progress;
    camera.position.y = 0.4 + p * 2.2;
    camera.position.z = 10 - p * 1.6;
    camera.lookAt(0, p * 1.4 - 0.2, -1);
    if (rig.current) rig.current.rotation.y = Math.sin(clock.t * 0.12) * 0.08;
    sculptures.current.forEach((sculpture, i) => {
      if (!sculpture) return;
      sculpture.rotation.y = clock.t * (0.2 + i * 0.05) + clock.tapPulse * 1.5;
      sculpture.position.y = Math.sin(clock.t * 0.6 + i) * 0.04;
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.surface, colors.raised, 1.1]} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <group ref={rig}>
        {PEDESTALS.map((pedestal, i) => {
          const x = pedestal.side * (viewport.width / 2) * pedestal.x;
          const base = -3.1;
          return (
            <group key={i} position={[x, base, pedestal.z]}>
              <mesh position={[0, pedestal.h / 2, 0]} material={stone}>
                <cylinderGeometry args={[pedestal.r, pedestal.r * 1.06, pedestal.h, 48]} />
              </mesh>
              <mesh position={[0, pedestal.h + 0.05, 0]} material={stone}>
                <cylinderGeometry args={[pedestal.r * 1.18, pedestal.r * 1.18, 0.1, 48]} />
              </mesh>
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[pedestal.r * 4, pedestal.r * 4]} />
                <meshBasicMaterial map={shadow} transparent opacity={0.4} depthWrite={false} />
              </mesh>
              <group
                ref={(node) => {
                  sculptures.current[i] = node;
                }}
              >
                <group position={[0, pedestal.h + 0.1 + pedestal.r * 0.7, 0]}>
                  <mesh material={bronze}>
                    {pedestal.shape === 'sphere' && <sphereGeometry args={[pedestal.r * 0.6, 48, 32]} />}
                    {pedestal.shape === 'torus' && <torusGeometry args={[pedestal.r * 0.55, pedestal.r * 0.16, 32, 64]} />}
                    {pedestal.shape === 'cone' && <coneGeometry args={[pedestal.r * 0.5, pedestal.r * 1.6, 4]} />}
                  </mesh>
                </group>
              </group>
            </group>
          );
        })}
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0.4, 10], fov: 35 }, environment: 1.1 };
export default scene;
