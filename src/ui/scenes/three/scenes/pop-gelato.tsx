'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MeshPhysicalMaterial, type Group } from 'three';
import { useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 29 Pop Gelato: glossy rounded shapes in coral and cobalt (a ball, a capsule, a ring) resting at the edges and bouncing
 * softly. A tap bounces the shape nearest to it higher, on a spring, and it settles with a squash; scrolling turns them.
 */

type Kind = 'ball' | 'capsule' | 'ring';
const SHAPES: Array<{ kind: Kind; x: number; y: number; z: number; s: number; cobalt: boolean }> = [
  { kind: 'ball', x: 0.82, y: 0.62, z: -0.5, s: 0.55, cobalt: false },
  { kind: 'capsule', x: -0.82, y: 0.22, z: -1, s: 0.5, cobalt: true },
  { kind: 'ring', x: 0.74, y: -0.36, z: -0.2, s: 0.45, cobalt: true },
  { kind: 'ball', x: -0.7, y: -0.78, z: 0.1, s: 0.4, cobalt: false },
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const shapes = useRef<Array<Group | null>>([]);
  const springs = useRef(SHAPES.map(() => ({ y: 0, v: 0 })));
  const seen = useRef(0);
  const coral = useMemo(() => new MeshPhysicalMaterial({ color: colors.button, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }), [colors.button]);
  const cobalt = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }), [colors.accent]);
  useEffect(
    () => () => {
      coral.dispose();
      cobalt.dispose();
    },
    [coral, cobalt],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    if (clock.tapCount !== seen.current) {
      seen.current = clock.tapCount;
      // The shape nearest the tap gets the kick.
      let nearest = 0;
      let best = Infinity;
      SHAPES.forEach((shape, i) => {
        const d = (shape.x * (viewport.width / 2) - clock.tap.x) ** 2 + (shape.y * (viewport.height / 2) - clock.tap.y) ** 2;
        if (d < best) {
          best = d;
          nearest = i;
        }
      });
      springs.current[nearest]!.v += 5;
    }
    SHAPES.forEach((shape, i) => {
      const group = shapes.current[i];
      const spring = springs.current[i]!;
      spring.v += (-spring.y * 40 - spring.v * 5) * dt;
      spring.y += spring.v * dt;
      if (!group) return;
      const bob = Math.abs(Math.sin(clock.t * 1.4 + i * 0.9)) * 0.12;
      const squash = Math.max(0, -spring.y) * 0.4 + (bob < 0.02 ? 0.04 : 0);
      group.position.set(shape.x * (viewport.width / 2), shape.y * (viewport.height / 2) + bob + Math.max(0, spring.y) * 0.6, shape.z);
      group.scale.set(shape.s * (1 + squash), shape.s * (1 - squash), shape.s * (1 + squash));
      group.rotation.set(0.3, clock.progress * Math.PI + i, shape.kind === 'capsule' ? 0.6 : 0);
    });
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1]} />
      <directionalLight position={[4, 6, 5]} intensity={2} />
      {SHAPES.map((shape, i) => (
        <group
          key={i}
          ref={(node) => {
            shapes.current[i] = node;
          }}
        >
          <mesh material={shape.cobalt ? cobalt : coral}>
            {shape.kind === 'ball' && <sphereGeometry args={[1, 48, 32]} />}
            {shape.kind === 'capsule' && <capsuleGeometry args={[0.55, 1, 12, 32]} />}
            {shape.kind === 'ring' && <torusGeometry args={[0.8, 0.32, 32, 64]} />}
          </mesh>
        </group>
      ))}
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 1 };
export default scene;
