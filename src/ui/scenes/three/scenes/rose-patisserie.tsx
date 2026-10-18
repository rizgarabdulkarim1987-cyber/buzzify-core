'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, InstancedMesh, MeshPhysicalMaterial, Object3D, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { curledGeometry, petalShape, seeded } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 21 Rose Patisserie: a translucent rose in sugar-glass pink, its petals spiralling open, and loose petals drifting down
 * the page's edges. The rose opens a little more as the page scrolls (and closes again); a tap sends nearby petals
 * swirling.
 */

const ROSE_PETALS = 18;
const LOOSE = 16;

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const rose = useRef<Group>(null);
  const petals = useRef<InstancedMesh>(null);
  const loose = useRef<InstancedMesh>(null);
  const swirl = useRef(0);
  const geometry = useMemo(() => curledGeometry(petalShape(1, 0.7), 0.55, 0.6), []);
  const sugar = useMemo(
    () =>
      low
        ? new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.25, transparent: true, opacity: 0.7, side: DoubleSide, clearcoat: 1 })
        : new MeshPhysicalMaterial({ color: colors.accent.clone().lerp(new Color('#ffffff'), 0.2), roughness: 0.2, transmission: 0.55, thickness: 0.4, side: DoubleSide, clearcoat: 1 }),
    [colors.accent, low],
  );
  const drift = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.4, transparent: true, opacity: 0.55, side: DoubleSide }), [colors.accent]);
  const random = useMemo(() => seeded(17), []);
  const looseSeeds = useMemo(
    () => Array.from({ length: LOOSE }, (_, i) => ({ side: i % 2 ? 1 : -1, x: 0.7 + random() * 0.3, offset: random(), speed: 0.08 + random() * 0.06, spin: random() * 6, z: -random() * 1.5 })),
    [random],
  );
  const dummy = useMemo(() => new Object3D(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      sugar.dispose();
      drift.dispose();
    },
    [geometry, sugar, drift],
  );

  useFrame((_, delta) => {
    swirl.current = approach(swirl.current, clock.tapPulse, 4, delta);
    const open = 0.25 + clock.progress * 0.55 + Math.sin(clock.t * 0.4) * 0.03;
    if (rose.current) {
      rose.current.position.set((viewport.width / 2) * 0.6, (viewport.height / 2) * 0.45, -0.8);
      rose.current.rotation.set(0.9, clock.t * 0.1, 0);
    }
    const instance = petals.current;
    if (instance) {
      for (let i = 0; i < ROSE_PETALS; i++) {
        const ring = i / ROSE_PETALS;
        const a = i * 2.399963;
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, a, 0);
        dummy.rotateX(-0.2 - ring * open * 1.6);
        dummy.scale.setScalar(0.35 + ring * 0.7);
        dummy.updateMatrix();
        instance.setMatrixAt(i, dummy.matrix);
      }
      instance.instanceMatrix.needsUpdate = true;
    }
    const falling = loose.current;
    if (falling) {
      looseSeeds.forEach((seed, i) => {
        const travel = (seed.offset + clock.t * seed.speed) % 1;
        const x = seed.side * (viewport.width / 2) * seed.x + Math.sin(clock.t * 0.8 + i) * 0.2;
        const y = (0.5 - travel) * viewport.height * 1.1;
        const near = Math.exp(-((clock.tap.x - x) ** 2 + (clock.tap.y - y) ** 2) / 2) * swirl.current;
        dummy.position.set(x + Math.cos(clock.t * 6 + i) * near * 0.5, y + Math.sin(clock.t * 6 + i) * near * 0.5, seed.z);
        dummy.rotation.set(clock.t * 0.7 + seed.spin, clock.t * 0.5 + seed.spin, seed.spin);
        dummy.scale.setScalar(0.14);
        dummy.updateMatrix();
        falling.setMatrixAt(i, dummy.matrix);
      });
      falling.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1.1]} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} color="#fff0f2" />
      <group ref={rose} scale={0.9}>
        <instancedMesh ref={petals} args={[geometry, sugar, ROSE_PETALS]} frustumCulled={false} />
      </group>
      <instancedMesh ref={loose} args={[geometry, drift, LOOSE]} frustumCulled={false} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 0.9 };
export default scene;
