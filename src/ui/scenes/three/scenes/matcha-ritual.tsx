'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CatmullRomCurve3, Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, TubeGeometry, Vector3, type Group, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { latheOf, PROFILES } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 13 Matcha Ritual: a tea bowl of matcha at the foot of the page and a bamboo whisk. The whisk travels across as the
 * page scrolls through its chapters (and back), whisking as it goes; the foam turns with it; a tap ripples the tea.
 */

const TINES = 14;

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const bowl = useRef<Group>(null);
  const whisk = useRef<Group>(null);
  const tea = useRef<Mesh>(null);
  const ripple = useRef(0);
  const bowlGeometry = useMemo(() => latheOf(PROFILES.bowl), []);
  const glaze = useMemo(() => new MeshPhysicalMaterial({ color: colors.text.clone().lerp(colors.accent, 0.25), roughness: 0.35, clearcoat: 0.5, side: DoubleSide }), [colors.text, colors.accent]);
  const matcha = useMemo(() => new MeshStandardMaterial({ color: colors.accent.clone().lerp(new Color('#9BB86A'), 0.5), roughness: 0.75 }), [colors.accent]);
  const bamboo = useMemo(() => new MeshStandardMaterial({ color: new Color('#D8C49A'), roughness: 0.6 }), []);
  const tines = useMemo(
    () =>
      Array.from({ length: TINES }, (_, i) => {
        const a = (i / TINES) * Math.PI * 2;
        const r = 0.22;
        return new TubeGeometry(
          new CatmullRomCurve3([new Vector3(0, 0.9, 0), new Vector3(Math.cos(a) * r * 0.7, 0.55, Math.sin(a) * r * 0.7), new Vector3(Math.cos(a) * r, 0.18, Math.sin(a) * r), new Vector3(Math.cos(a) * r * 0.5, 0, Math.sin(a) * r * 0.5)]),
          24,
          0.012,
          5,
        );
      }),
    [],
  );
  useEffect(
    () => () => {
      bowlGeometry.dispose();
      glaze.dispose();
      matcha.dispose();
      bamboo.dispose();
      tines.forEach((tine) => tine.dispose());
    },
    [bowlGeometry, glaze, matcha, bamboo, tines],
  );

  useFrame((_, delta) => {
    const bowlX = (viewport.width / 2) * 0.4;
    const bowlY = -(viewport.height / 2) * 0.82;
    bowl.current?.position.set(bowlX, bowlY, 0);
    ripple.current = approach(ripple.current, clock.tapPulse, 5, delta);
    if (tea.current) {
      tea.current.rotation.z = clock.t * 0.6;
      tea.current.position.y = 0.6 + Math.sin(clock.t * 12) * 0.01 * ripple.current;
      tea.current.scale.set(1 + ripple.current * 0.02, 1 + ripple.current * 0.02, 1);
    }
    if (whisk.current) {
      // Across the chapters with the scroll, from the far edge to the bowl.
      const startX = -(viewport.width / 2) * 0.75;
      const x = startX + (bowlX - startX) * clock.progress;
      whisk.current.position.set(x, bowlY + 0.9 - clock.progress * 0.6 + Math.sin(clock.t * 2) * 0.03, 0.3);
      whisk.current.rotation.set(0.35 * (1 - clock.progress), clock.t * 1.2, Math.sin(clock.t * 4) * 0.12);
    }
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1]} />
      <directionalLight position={[3, 6, 5]} intensity={1.8} />
      <group ref={bowl} scale={0.95}>
        <mesh geometry={bowlGeometry} material={glaze} />
        <mesh ref={tea} material={matcha} position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.93, 48]} />
        </mesh>
      </group>
      <group ref={whisk} scale={0.9}>
        <mesh material={bamboo} position={[0, 1.35, 0]}>
          <cylinderGeometry args={[0.07, 0.08, 0.9, 16]} />
        </mesh>
        {tines.map((tine, i) => (
          <mesh key={i} geometry={tine} material={bamboo} />
        ))}
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0.6, 8], fov: 40 }, environment: 0.7 };
export default scene;
