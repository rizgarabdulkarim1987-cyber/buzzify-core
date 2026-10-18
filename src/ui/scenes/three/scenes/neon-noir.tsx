'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, Color, MeshBasicMaterial, MeshPhysicalMaterial, type Group, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 17 Neon Noir: luminous rings in the dark, violet and mint, each with a soft halo. A change of category reorients them
 * and trades their colours, eased over a second: nothing flashes. A tap swells them slightly; scrolling turns the set.
 */

const RINGS = [
  { r: 1.7, x: 0.62, y: 0.42, z: -1.2, mint: false },
  { r: 1.15, x: 0.62, y: 0.42, z: -1, mint: true },
  { r: 1.4, x: -0.7, y: -0.6, z: -2.4, mint: true },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const rings = useRef<Array<Group | null>>([]);
  const cores = useRef<Array<Mesh | null>>([]);
  const halos = useRef<Array<Mesh | null>>([]);
  const turn = useRef(0);
  const swap = useRef(0);
  const violet = colors.accent;
  const mint = useMemo(() => new Color('#87D6C6'), []);
  const coreMaterials = useMemo(() => RINGS.map(() => new MeshPhysicalMaterial({ color: new Color('#111'), emissive: new Color('#fff'), emissiveIntensity: 1.6, roughness: 0.3 })), []);
  const haloMaterials = useMemo(() => RINGS.map(() => new MeshBasicMaterial({ transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false })), []);
  useEffect(
    () => () => {
      coreMaterials.forEach((material) => material.dispose());
      haloMaterials.forEach((material) => material.dispose());
    },
    [coreMaterials, haloMaterials],
  );
  const mixed = useMemo(() => new Color(), []);

  useFrame((_, delta) => {
    turn.current = approach(turn.current, clock.category * 0.9, 1.6, delta);
    swap.current = approach(swap.current, clock.category % 2, 1.2, delta);
    RINGS.forEach((ring, i) => {
      const group = rings.current[i];
      if (!group) return;
      group.position.set(ring.x * (viewport.width / 2), ring.y * (viewport.height / 2), ring.z);
      group.rotation.set(0.9 + Math.sin(turn.current + i) * 0.5 + clock.progress * 0.6, turn.current * (i % 2 ? -0.7 : 0.7) + clock.t * 0.08, i * 0.6);
      group.scale.setScalar(1 + clock.tapPulse * 0.05);
      const toMint = ring.mint ? 1 - swap.current : swap.current;
      mixed.copy(violet).lerp(mint, toMint);
      coreMaterials[i]!.emissive.copy(mixed);
      haloMaterials[i]!.color.copy(mixed);
      haloMaterials[i]!.opacity = (0.08 + Math.sin(clock.t * 0.8 + i) * 0.02) * (0.6 + clock.intensity * 0.6);
    });
  });

  return (
    <>
      <ambientLight intensity={0.1} />
      {RINGS.map((ring, i) => (
        <group
          key={i}
          ref={(node) => {
            rings.current[i] = node;
          }}
        >
          <mesh
            ref={(node) => {
              cores.current[i] = node;
            }}
            material={coreMaterials[i]}
          >
            <torusGeometry args={[ring.r, 0.03, 16, 160]} />
          </mesh>
          <mesh
            ref={(node) => {
              halos.current[i] = node;
            }}
            material={haloMaterials[i]}
          >
            <torusGeometry args={[ring.r, 0.16, 16, 160]} />
          </mesh>
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 9], fov: 38 }, environment: 0.3 };
export default scene;
