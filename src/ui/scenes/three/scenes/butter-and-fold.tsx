'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, Color, DoubleSide, MeshPhysicalMaterial, PlaneGeometry, type Group, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 20 Butter & Fold: the layers of laminated dough, golden sheets of pastry and butter lying in soft waves at the foot of
 * the page. Scrolling unfolds them, lifting the layers apart (and folding them back on the way up); a tap ripples them.
 */

const LAYERS = 7;

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const stack = useRef<Group>(null);
  const layers = useRef<Array<Mesh | null>>([]);
  const ripple = useRef({ amount: 0, x: 0 });
  const geometries = useMemo(() => Array.from({ length: LAYERS }, () => new PlaneGeometry(14, 3.2, low ? 48 : 80, 6)), [low]);
  const bases = useMemo(() => geometries.map((geometry) => Float32Array.from(geometry.attributes.position!.array as Float32Array)), [geometries]);
  const dough = useMemo(() => new MeshPhysicalMaterial({ color: new Color('#E8CE86').lerp(colors.raised, 0.25), roughness: 0.6, sheen: 0.5, sheenColor: new Color('#fff3d0'), side: DoubleSide }), [colors.raised]);
  const crust = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent.clone().lerp(new Color('#C8913F'), 0.6), roughness: 0.55, clearcoat: 0.3, side: DoubleSide }), [colors.accent]);
  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose());
      dough.dispose();
      crust.dispose();
    },
    [geometries, dough, crust],
  );

  useFrame((_, delta) => {
    if (clock.tapPulse > 0.95) ripple.current.x = clock.tap.x;
    ripple.current.amount = approach(ripple.current.amount, clock.tapPulse, 4, delta);
    const open = clock.progress;
    geometries.forEach((geometry, i) => {
      const position = geometry.attributes.position as BufferAttribute;
      const base = bases[i]!;
      for (let v = 0; v < position.count; v++) {
        const x = base[v * 3]!;
        const wave = Math.sin(x * 0.9 + i * 0.5 + clock.t * 0.5) * 0.22 + Math.sin(x * 2.1 - clock.t * 0.3) * 0.06;
        const tap = Math.sin((x - ripple.current.x) * 3 - clock.t * 8) * Math.exp(-Math.abs(x - ripple.current.x) * 0.8) * ripple.current.amount * 0.18;
        position.setZ(v, wave + tap);
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      const mesh = layers.current[i];
      if (mesh) mesh.position.y = i * (0.14 + open * 0.55);
    });
    if (stack.current) stack.current.rotation.x = -0.85 + open * 0.45;
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1]} />
      <directionalLight position={[3, 6, 5]} intensity={1.8} color="#fff0d6" />
      <group ref={stack} position={[0, -2.7, -1]}>
        {geometries.map((geometry, i) => (
          <mesh
            key={i}
            ref={(node) => {
              layers.current[i] = node;
            }}
            geometry={geometry}
            material={i % 2 ? crust : dough}
          />
        ))}
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 9], fov: 38 }, environment: 0.8 };
export default scene;
