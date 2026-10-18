'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MeshPhysicalMaterial, type Group, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 14 Midnight Espresso: copper rings turning on their own axes, like a gyroscope at night, with steam rising past them.
 * A tap spins the rings faster for a moment; scrolling tips the whole assembly toward the guest.
 */

const RINGS = [
  { r: 1.6, tube: 0.03, axis: [1, 0.3, 0], speed: 0.18 },
  { r: 1.25, tube: 0.026, axis: [0.2, 1, 0.4], speed: -0.24 },
  { r: 0.92, tube: 0.022, axis: [0.6, 0.2, 1], speed: 0.31 },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const group = useRef<Group>(null);
  const rings = useRef<Array<Mesh | null>>([]);
  const boost = useRef(0);
  const angles = useRef(RINGS.map(() => 0));
  const copper = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, metalness: 1, roughness: 0.22, clearcoat: 0.6 }), [colors.accent]);
  const steel = useMemo(() => new MeshPhysicalMaterial({ color: colors.text.clone().lerp(colors.bg, 0.5), metalness: 1, roughness: 0.35 }), [colors.text, colors.bg]);
  useEffect(
    () => () => {
      copper.dispose();
      steel.dispose();
    },
    [copper, steel],
  );

  useFrame((_, delta) => {
    boost.current = approach(boost.current, clock.tapPulse * 6, 2.5, delta);
    if (group.current) {
      group.current.position.set((viewport.width / 2) * 0.62, (viewport.height / 2) * 0.38, -1);
      group.current.rotation.x = -0.4 + clock.progress * 0.9;
    }
    RINGS.forEach((ring, i) => {
      const mesh = rings.current[i];
      if (!mesh) return;
      // Ambient turning comes from the clock (still when ambient is off); a tap adds a spin of its own.
      angles.current[i]! += ring.speed * boost.current * delta;
      const a = angles.current[i]! + clock.t * ring.speed;
      mesh.rotation.set(a * ring.axis[0]!, a * ring.axis[1]!, a * ring.axis[2]!);
    });
  });

  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight position={[4, 5, 6]} intensity={2.4} color="#ffd9b8" />
      <directionalLight position={[-5, 0, 2]} intensity={0.8} color="#9db7d6" />
      <group ref={group}>
        {RINGS.map((ring, i) => (
          <mesh
            key={i}
            ref={(node) => {
              rings.current[i] = node;
            }}
            material={i === 1 ? steel : copper}
          >
            <torusGeometry args={[ring.r, ring.tube, 16, 128]} />
          </mesh>
        ))}
        <mesh material={copper}>
          <sphereGeometry args={[0.18, 32, 24]} />
        </mesh>
      </group>
      <Particles count={16} color={colors.text} size={0.3} opacity={0.08} speed={0.22} spread={[0.3, 0.8, 0.5]} drift={0.2} seed={14} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 9], fov: 38 }, environment: 0.9 };
export default scene;
