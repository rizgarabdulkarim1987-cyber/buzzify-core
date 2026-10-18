'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, InstancedMesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, type Group, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import { beanGeometry, latheOf, PROFILES, seeded } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 11 Copper Roast: roasted beans float at the edges of the page, turning. A tap spins the beans near it. Scrolling scrubs
 * through the brew, both ways: the beans fall into a copper-rimmed cup, the coffee rises in it, and steam comes off it.
 */

const BEANS = 26;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const beans = useRef<InstancedMesh>(null);
  const cup = useRef<Group>(null);
  const coffee = useRef<Mesh>(null);
  const spins = useRef(new Float32Array(BEANS));
  const count = low ? 18 : BEANS;
  const geometry = useMemo(() => beanGeometry(), []);
  const roast = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent.clone().multiplyScalar(0.45), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.35 }), [colors.accent]);
  const ceramic = useMemo(() => new MeshPhysicalMaterial({ color: colors.text, roughness: 0.25, clearcoat: 0.6, side: DoubleSide }), [colors.text]);
  const copper = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, metalness: 1, roughness: 0.3 }), [colors.accent]);
  const liquid = useMemo(() => new MeshStandardMaterial({ color: colors.accent.clone().multiplyScalar(0.32), roughness: 0.2 }), [colors.accent]);
  const cupGeometry = useMemo(() => latheOf(PROFILES.cup), []);
  const random = useMemo(() => seeded(42), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        side: i % 2 === 0 ? -1 : 1,
        along: random() * 2 - 1,
        inset: random() * 0.22,
        z: -random() * 2,
        axis: [random() - 0.5, random() - 0.5, random() - 0.5] as const,
        speed: 0.2 + random() * 0.4,
        delay: random() * 0.35,
        scale: 0.13 + random() * 0.06,
      })),
    [count, random],
  );
  const dummy = useMemo(() => new Object3D(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      roast.dispose();
      ceramic.dispose();
      copper.dispose();
      liquid.dispose();
      cupGeometry.dispose();
    },
    [geometry, roast, ceramic, copper, liquid, cupGeometry],
  );

  useFrame((_, delta) => {
    const instance = beans.current;
    const cupX = (viewport.width / 2) * 0.62;
    const cupY = -(viewport.height / 2) * 0.72;
    if (cup.current) cup.current.position.set(cupX, cupY - (1 - smooth(clock.progress * 3)) * 0.6, 0.4);
    if (coffee.current) {
      const level = smooth(clock.progress * 2.2 - 0.6);
      coffee.current.position.y = 0.14 + level * 0.66;
      coffee.current.scale.setScalar(0.55 + level * 0.17);
      coffee.current.visible = level > 0.02;
    }
    if (!instance) return;
    seeds.forEach((seed, i) => {
      const fx = seed.side * (viewport.width / 2) * (0.92 - seed.inset);
      const fy = seed.along * (viewport.height / 2);
      // The brew: each bean falls into the cup in turn as the page scrolls, and climbs back out scrolling up.
      const fall = smooth((clock.progress - seed.delay) * 3);
      const x = fx + (cupX - fx) * fall;
      const y = fy + (cupY + 0.5 - fy) * fall;
      const near = Math.exp(-((clock.tap.x - fx) ** 2 + (clock.tap.y - fy) ** 2) / 1.6);
      spins.current[i] = approach(spins.current[i]!, clock.tapPulse * near * 9, 3, delta);
      dummy.position.set(x, y + Math.sin(clock.t * 0.7 + i) * 0.05 * (1 - fall), seed.z * (1 - fall));
      dummy.rotation.set(seed.axis[0] * clock.t * seed.speed * 3 + spins.current[i]! * clock.t, seed.axis[1] * clock.t * seed.speed * 3, seed.axis[2] * 2 + i);
      dummy.scale.setScalar(seed.scale * (1 - fall * 0.35));
      dummy.updateMatrix();
      instance.setMatrixAt(i, dummy.matrix);
    });
    instance.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 5, 6]} intensity={2.2} color="#ffe6c8" />
      <directionalLight position={[-4, -1, 2]} intensity={0.6} color={colors.accent} />
      <instancedMesh ref={beans} args={[geometry, roast, count]} frustumCulled={false} />
      <group ref={cup} scale={0.75}>
        <mesh geometry={cupGeometry} material={ceramic} />
        <mesh material={copper} position={[0, 0.94, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.72, 0.025, 12, 64]} />
        </mesh>
        <mesh ref={coffee} material={liquid} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1, 48]} />
        </mesh>
      </group>
      <Particles count={14} color={colors.text} size={0.22} opacity={0.12} speed={0.25} spread={[0.18, 0.4, 0.3]} drift={0.12} seed={4} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 0.8 };
export default scene;
