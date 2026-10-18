'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 19 Paris Maison: a three-tier pastry stand of porcelain and gold set with macarons. Switching collections (categories)
 * turns the stand a third of the way round, eased like a waiter presenting it; a tap gives it a nudge; scrolling lifts
 * the view to look down on the top tier.
 */

const TIERS = [
  { y: 0, r: 1.15, count: 10 },
  { y: 0.95, r: 0.85, count: 7 },
  { y: 1.8, r: 0.55, count: 4 },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const stand = useRef<Group>(null);
  const turn = useRef(0);
  const nudge = useRef(0);
  const porcelain = useMemo(() => new MeshPhysicalMaterial({ color: colors.card, roughness: 0.2, clearcoat: 1 }), [colors.card]);
  const gold = useMemo(() => new MeshPhysicalMaterial({ color: new Color('#C9A45C'), metalness: 1, roughness: 0.25 }), []);
  const shells = useMemo(
    () => [colors.accent, colors.raised, new Color('#BFD3A0'), new Color('#F1D7A8')].map((tone) => new MeshStandardMaterial({ color: tone, roughness: 0.75 })),
    [colors.accent, colors.raised],
  );
  const filling = useMemo(() => new MeshStandardMaterial({ color: colors.card, roughness: 0.5 }), [colors.card]);
  useEffect(
    () => () => {
      porcelain.dispose();
      gold.dispose();
      shells.forEach((shell) => shell.dispose());
      filling.dispose();
    },
    [porcelain, gold, shells, filling],
  );

  useFrame(({ camera }, delta) => {
    turn.current = approach(turn.current, clock.category * ((Math.PI * 2) / 3), 2, delta);
    nudge.current = approach(nudge.current, clock.tapPulse * 0.4, 5, delta);
    if (stand.current) {
      stand.current.position.set((viewport.width / 2) * 0.62, -(viewport.height / 2) * 0.55, -1);
      stand.current.rotation.y = turn.current + nudge.current + clock.t * 0.04;
    }
    camera.position.y = 0.5 + clock.progress * 2.4;
    camera.lookAt(0, 0, -1);
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.raised, 1.1]} />
      <directionalLight position={[4, 6, 5]} intensity={1.8} color="#fff1e6" />
      <group ref={stand} scale={0.85}>
        <mesh material={gold} position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 2.6, 12]} />
        </mesh>
        <mesh material={gold} position={[0, 2.55, 0]}>
          <sphereGeometry args={[0.09, 16, 12]} />
        </mesh>
        {TIERS.map((tier, t) => (
          <group key={t} position={[0, tier.y, 0]}>
            <mesh material={porcelain}>
              <cylinderGeometry args={[tier.r, tier.r * 0.92, 0.06, 64]} />
            </mesh>
            <mesh material={gold} position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[tier.r, 0.015, 8, 64]} />
            </mesh>
            {Array.from({ length: tier.count }, (_, i) => {
              const a = (i / tier.count) * Math.PI * 2;
              const r = tier.r * 0.7;
              const shell = shells[(i + t) % shells.length]!;
              return (
                <group key={i} position={[Math.cos(a) * r, 0.13, Math.sin(a) * r]} rotation={[0.25, -a, 0]}>
                  <mesh material={shell} position={[0, 0.06, 0]} scale={[1, 0.42, 1]}>
                    <sphereGeometry args={[0.15, 24, 16]} />
                  </mesh>
                  <mesh material={filling}>
                    <cylinderGeometry args={[0.13, 0.13, 0.05, 24]} />
                  </mesh>
                  <mesh material={shell} position={[0, -0.06, 0]} scale={[1, 0.42, 1]}>
                    <sphereGeometry args={[0.15, 24, 16]} />
                  </mesh>
                </group>
              );
            })}
          </group>
        ))}
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0.5, 8], fov: 40 }, environment: 1 };
export default scene;
