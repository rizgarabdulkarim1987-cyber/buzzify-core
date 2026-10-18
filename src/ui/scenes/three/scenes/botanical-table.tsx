'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { curledGeometry, leafShape, seeded } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 08 Botanical Table: sprigs of herbs growing in from the edges of the page, leaves turning slowly in a light breeze.
 * A tap rustles the leaves nearest to it; scrolling lets the sprigs lean and rise a little. The middle stays clear.
 */

const LEAVES = 46;

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const mesh = useRef<InstancedMesh>(null);
  const rustle = useRef(0);
  const count = low ? 30 : LEAVES;
  const geometry = useMemo(() => curledGeometry(leafShape(0.62, 0.26), 0.35, 0.4), []);
  const material = useMemo(() => new MeshStandardMaterial({ color: colors.accent.clone().lerp(colors.raised, 0.25), roughness: 0.7, side: DoubleSide }), [colors.accent, colors.raised]);
  const leaves = useMemo(() => {
    const random = seeded(8);
    return Array.from({ length: count }, (_, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      return {
        side,
        // Along the edge, top to bottom, and a little in from it.
        along: random() * 2 - 1,
        inset: 0.02 + random() * 0.16,
        z: -random() * 1.6,
        angle: (side === -1 ? -0.6 : 0.6) + (random() - 0.5) * 1.6,
        scale: 0.7 + random() * 0.6,
        phase: random() * Math.PI * 2,
        tint: random(),
      };
    });
  }, [count]);
  const dummy = useMemo(() => new Object3D(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => {
    const instance = mesh.current;
    if (!instance) return;
    rustle.current = approach(rustle.current, clock.tapPulse, 6, delta);
    leaves.forEach((leaf, i) => {
      const x = leaf.side * (viewport.width / 2) * (1 - leaf.inset);
      const y = leaf.along * (viewport.height / 2) + clock.progress * 0.6;
      const near = Math.exp(-((clock.tap.x - x) ** 2 + (clock.tap.y - y) ** 2) / 1.5);
      const breeze = Math.sin(clock.t * 0.9 + leaf.phase) * 0.12 + Math.sin(clock.t * 2.3 + leaf.phase) * 0.04;
      dummy.position.set(x, y, leaf.z);
      dummy.rotation.set(0.4 + breeze, leaf.side * 0.3, leaf.angle + breeze + rustle.current * near * Math.sin(clock.t * 18 + i) * 0.5);
      dummy.scale.setScalar(leaf.scale);
      dummy.updateMatrix();
      instance.setMatrixAt(i, dummy.matrix);
    });
    instance.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <hemisphereLight args={[colors.surface, colors.accent, 1.2]} />
      <directionalLight position={[3, 5, 5]} intensity={1.6} />
      <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 0.8 };
export default scene;
