'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshPhysicalMaterial, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 25 Celebration House: a tiered cake that assembles as the page scrolls: each tier floats down onto the one below in
 * turn, the topper last, and lifts off again in reverse when the guest scrolls back up. A tap turns the cake; gold
 * flecks drift around it.
 */

const TIERS = [
  { r: 1.15, h: 0.62 },
  { r: 0.86, h: 0.56 },
  { r: 0.58, h: 0.5 },
];

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const cake = useRef<Group>(null);
  const tiers = useRef<Array<Group | null>>([]);
  const topper = useRef<Group>(null);
  const spin = useRef(0);
  const icing = useMemo(() => new MeshPhysicalMaterial({ color: colors.card, roughness: 0.45, sheen: 0.6, sheenColor: colors.accent }), [colors.card, colors.accent]);
  const ribbon = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.35, clearcoat: 0.5 }), [colors.accent]);
  const champagne = useMemo(() => new Color('#C9AE84'), []);
  const gold = useMemo(() => new MeshPhysicalMaterial({ color: champagne, metalness: 1, roughness: 0.25 }), [champagne]);
  useEffect(
    () => () => {
      icing.dispose();
      ribbon.dispose();
      gold.dispose();
    },
    [icing, ribbon, gold],
  );

  useFrame((_, delta) => {
    spin.current = approach(spin.current, spin.current + clock.tapPulse * 0.6, 4, delta);
    if (cake.current) {
      cake.current.position.set((viewport.width / 2) * 0.58, -(viewport.height / 2) * 0.72, -0.6);
      cake.current.rotation.y = clock.t * 0.08 + spin.current;
    }
    let base = 0;
    TIERS.forEach((tier, i) => {
      const group = tiers.current[i];
      // Tier i lands between a quarter and a half of the way through its share of the scroll.
      const landed = smooth(clock.progress * 3.2 - i * 0.7);
      if (group) {
        group.position.y = base + tier.h / 2 + (1 - landed) * (2.4 + i * 0.6);
        group.scale.setScalar(0.92 + landed * 0.08);
      }
      base += tier.h;
    });
    if (topper.current) {
      const landed = smooth(clock.progress * 3.2 - 2.2);
      topper.current.position.y = base + 0.25 + (1 - landed) * 3;
      topper.current.rotation.y = clock.t * 0.6;
    }
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1.1]} />
      <directionalLight position={[4, 6, 5]} intensity={1.7} color="#fff3ea" />
      <group ref={cake} scale={0.8}>
        {TIERS.map((tier, i) => (
          <group
            key={i}
            ref={(node) => {
              tiers.current[i] = node;
            }}
          >
            <mesh material={icing}>
              <cylinderGeometry args={[tier.r, tier.r, tier.h, 64]} />
            </mesh>
            <mesh material={ribbon} position={[0, -tier.h / 2 + 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[tier.r, 0.04, 12, 64]} />
            </mesh>
            {Array.from({ length: 12 }, (_, b) => {
              const a = (b / 12) * Math.PI * 2;
              return (
                <mesh key={b} material={gold} position={[Math.cos(a) * tier.r, tier.h / 2 - 0.02, Math.sin(a) * tier.r]}>
                  <sphereGeometry args={[0.035, 10, 8]} />
                </mesh>
              );
            })}
          </group>
        ))}
        <group ref={topper}>
          <mesh material={gold}>
            <torusKnotGeometry args={[0.12, 0.035, 64, 8, 2, 3]} />
          </mesh>
        </group>
      </group>
      <Particles count={22} color={champagne} size={0.05} opacity={0.6} speed={0.06} glow edges seed={25} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0.4, 8], fov: 40 }, environment: 1 };
export default scene;
