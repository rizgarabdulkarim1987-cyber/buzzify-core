'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MeshPhysicalMaterial, type Group } from 'three';
import { useSceneClock, usePaletteColors } from '../kit/clock';
import { pebbleGeometry } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 16 Nordic Brew: smooth river stones balanced in a stack. A tap tips the stack, and it rocks back on a soft spring;
 * scrolling turns it slowly; at rest it breathes almost imperceptibly.
 */

const STONES = [
  { y: 0, s: [1.15, 0.5, 1], seed: 2, tone: 'raised' as const },
  { y: 0.58, s: [0.86, 0.42, 0.8], seed: 5, tone: 'accent' as const },
  { y: 1.06, s: [0.62, 0.34, 0.6], seed: 9, tone: 'raised' as const },
  { y: 1.42, s: [0.4, 0.26, 0.4], seed: 13, tone: 'accent' as const },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const stack = useRef<Group>(null);
  const tilt = useRef({ angle: 0, velocity: 0, seen: 0 });
  const geometries = useMemo(() => STONES.map((stone) => pebbleGeometry(stone.seed, 1)), []);
  const stone = useMemo(() => new MeshPhysicalMaterial({ color: colors.raised.clone().lerp(colors.muted, 0.25), roughness: 0.62, clearcoat: 0.2 }), [colors.raised, colors.muted]);
  const moss = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.7, sheen: 0.4, sheenColor: colors.card }), [colors.accent, colors.card]);
  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose());
      stone.dispose();
      moss.dispose();
    },
    [geometries, stone, moss],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const state = tilt.current;
    // A tap gives the stack a push away from where it landed; a spring brings it back.
    if (clock.tapCount !== state.seen) {
      state.seen = clock.tapCount;
      state.velocity += (clock.tap.x > (viewport.width / 2) * 0.55 ? 1 : -1) * 1.4;
    }
    state.velocity += (-state.angle * 26 - state.velocity * 3.2) * dt;
    state.angle += state.velocity * dt;
    if (stack.current) {
      stack.current.position.set((viewport.width / 2) * 0.6, -(viewport.height / 2) * 0.82, 0);
      stack.current.rotation.set(0, clock.progress * Math.PI * 0.8 + clock.t * 0.04, state.angle * 0.12 + Math.sin(clock.t * 0.6) * 0.01);
    }
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.raised, 1.1]} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <group ref={stack} scale={0.82}>
        {STONES.map((item, i) => (
          <mesh key={i} geometry={geometries[i]} material={item.tone === 'accent' ? moss : stone} position={[0, item.y, 0]} scale={item.s as [number, number, number]} />
        ))}
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0.3, 8], fov: 40 }, environment: 0.8 };
export default scene;
