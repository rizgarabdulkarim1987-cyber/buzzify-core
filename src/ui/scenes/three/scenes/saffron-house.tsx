'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, ExtrudeGeometry, MeshPhysicalMaterial, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import { starShape } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 09 Saffron House: eight-point stars of brass, the geometry of a Middle Eastern screen, turning slowly in the dark with
 * saffron and sumac drifting past. Choosing another category turns each star an eighth further; a tap scatters the spice
 * around it; scrolling tips the stars toward the guest.
 */

const STARS = [
  { x: 0.78, y: 0.6, z: -0.6, s: 1.05 },
  { x: -0.82, y: -0.35, z: -1.8, s: 0.85 },
  { x: 0.55, y: -0.82, z: -0.2, s: 0.5 },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const stars = useRef<Array<Group | null>>([]);
  const turn = useRef(0);
  const geometry = useMemo(() => new ExtrudeGeometry(starShape(8, 1, 0.72, 0.34), { depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }), []);
  const inner = useMemo(() => new ExtrudeGeometry(starShape(8, 0.5, 0.36), { depth: 0.2, bevelEnabled: false }), []);
  const brass = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, metalness: 1, roughness: 0.3, clearcoat: 0.4 }), [colors.accent]);
  const deep = useMemo(() => new MeshPhysicalMaterial({ color: colors.bg.clone().lerp(colors.accent, 0.25), metalness: 0.6, roughness: 0.4 }), [colors.bg, colors.accent]);
  useEffect(
    () => () => {
      geometry.dispose();
      inner.dispose();
      brass.dispose();
      deep.dispose();
    },
    [geometry, inner, brass, deep],
  );
  const sumac = useMemo(() => new Color('#9E2F2F'), []);

  useFrame((_, delta) => {
    // An eighth of a turn for each category, eased.
    turn.current = approach(turn.current, clock.category * (Math.PI / 4), 2.4, delta);
    STARS.forEach((star, i) => {
      const group = stars.current[i];
      if (!group) return;
      group.position.set(star.x * (viewport.width / 2), star.y * (viewport.height / 2) + Math.sin(clock.t * 0.5 + i) * 0.05, star.z);
      group.rotation.set(-0.3 + clock.progress * 0.8 * (i % 2 ? -1 : 1), Math.sin(clock.t * 0.3 + i) * 0.25, turn.current * (i % 2 ? -1 : 1) + clock.t * 0.05);
    });
  });

  return (
    <>
      <ambientLight intensity={0.2} />
      <directionalLight position={[4, 5, 6]} intensity={2} color="#ffe2b0" />
      <directionalLight position={[-5, -2, 3]} intensity={0.6} color={colors.accent} />
      {STARS.map((star, i) => (
        <group
          key={i}
          ref={(node) => {
            stars.current[i] = node;
          }}
          scale={star.s}
        >
          <mesh geometry={geometry} material={brass} />
          <mesh geometry={inner} material={deep} position={[0, 0, -0.03]} rotation={[0, 0, Math.PI / 8]} />
        </group>
      ))}
      <Particles count={36} color={colors.accent} size={0.045} opacity={0.75} speed={0.06} edges seed={9} drift={0.3} />
      <Particles count={18} color={sumac} size={0.04} opacity={0.6} speed={0.05} direction={-1} edges seed={19} drift={0.25} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 9], fov: 38 }, environment: 0.7 };
export default scene;
