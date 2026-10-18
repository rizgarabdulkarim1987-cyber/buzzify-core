'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { DoubleSide, MeshPhysicalMaterial } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { Ribbon } from '../kit/ribbons';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 22 Cocoa Atelier: ribbons of glossy chocolate, dark and milk, flowing through the page in long folds. Scrolling travels
 * along them, chapter by chapter, and back; a tap makes the nearest ribbon fold over on itself.
 */

const DARK: Array<[number, number, number]> = [
  [-4, 2.6, -1],
  [-1.8, 1.2, 0.6],
  [0.6, 2.2, -0.4],
  [2.6, 0.6, 0.5],
  [4.2, 1.8, -0.8],
];
const MILK: Array<[number, number, number]> = [
  [-4.2, -0.6, -0.5],
  [-2, -2.2, 0.5],
  [0.4, -1, -0.6],
  [2.4, -2.6, 0.4],
  [4.4, -1.2, -0.4],
];
const DEEP: Array<[number, number, number]> = [
  [-4, -4, -2],
  [-1, -5, -1.4],
  [2, -4.2, -2.2],
  [4.4, -5.4, -1.6],
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const dark = useMemo(() => new MeshPhysicalMaterial({ color: colors.bg.clone().lerp(colors.accent, 0.35).multiplyScalar(0.7), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12, side: DoubleSide }), [colors.bg, colors.accent]);
  const milk = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.22, clearcoat: 0.9, side: DoubleSide }), [colors.accent]);
  useEffect(
    () => () => {
      dark.dispose();
      milk.dispose();
    },
    [dark, milk],
  );

  useFrame(({ camera }, delta) => {
    camera.position.y = approach(camera.position.y, -clock.progress * 5, 3, delta);
    camera.position.z = 10 - Math.sin(clock.progress * Math.PI) * 1.2;
  });

  return (
    <>
      <ambientLight intensity={0.2} />
      <directionalLight position={[4, 5, 6]} intensity={2.2} color="#ffe6cc" />
      <directionalLight position={[-5, -3, 2]} intensity={0.6} color={colors.accent} />
      <Ribbon points={DARK} width={0.7} twist={Math.PI * 2} material={dark} position={[0.4, 0.4, 0]} phase={0.6} />
      <Ribbon points={MILK} width={0.5} twist={-Math.PI * 1.5} material={milk} position={[-0.3, 0, 0]} phase={2.2} />
      <Ribbon points={DEEP} width={0.8} twist={Math.PI} material={dark} position={[0, 0, -1]} phase={4} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 10], fov: 35 }, environment: 0.9 };
export default scene;
