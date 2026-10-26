'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, MeshPhysicalMaterial, type PointLight, type SpotLight } from 'three';
import { useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import { Ribbon } from '../kit/ribbons';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 01 Obsidian Gold: sculptural gold ribbons hanging in a dark room. They undulate slowly, twist when a tap lands near
 * them, and the light travels across them as the page scrolls, from a high warm key to a low raking light.
 */

const UPPER: Array<[number, number, number]> = [
  [-3.2, 1.2, -1],
  [-1.4, 2.1, 0.4],
  [0.4, 1.4, -0.6],
  [1.8, 2.5, 0.2],
  [3.4, 1.6, -0.8],
];
const LOWER: Array<[number, number, number]> = [
  [-3.4, -1.4, -0.4],
  [-1.6, -2.4, 0.6],
  [0.2, -1.6, -0.2],
  [2, -2.6, 0.5],
  [3.6, -1.8, -0.6],
];
const FAR: Array<[number, number, number]> = [
  [-3, 0.4, -3],
  [-0.8, -0.6, -2.4],
  [1.2, 0.8, -3.2],
  [3.2, -0.2, -2.6],
];

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const key = useRef<SpotLight>(null);
  const glint = useRef<PointLight>(null);
  const gold = useMemo(
    () => new MeshPhysicalMaterial({ color: colors.accent, metalness: 1, roughness: 0.24, clearcoat: 0.7, clearcoatRoughness: 0.2, side: DoubleSide }),
    [colors.accent],
  );
  const shadowGold = useMemo(
    () => new MeshPhysicalMaterial({ color: colors.accent.clone().multiplyScalar(0.55), metalness: 1, roughness: 0.4, side: DoubleSide }),
    [colors.accent],
  );
  useEffect(
    () => () => {
      gold.dispose();
      shadowGold.dispose();
    },
    [gold, shadowGold],
  );
  const warm = useMemo(() => new Color('#ffd9a0'), []);

  useFrame(() => {
    const p = clock.progress;
    // The key light travels from high and to the left down to a raking light from the right as the page scrolls.
    if (key.current) {
      key.current.position.set(-4 + p * 9, 5 - p * 6, 4);
      key.current.intensity = 60 + Math.sin(clock.t * 0.4) * 6;
    }
    if (glint.current) {
      glint.current.position.set(clock.tap.x, clock.tap.y, 1.5);
      glint.current.intensity = clock.tapPulse * 8;
    }
  });

  return (
    <>
      <ambientLight intensity={0.15} />
      <spotLight ref={key} angle={0.6} penumbra={0.9} color={warm} distance={30} decay={1.6} />
      <pointLight ref={glint} color={warm} distance={5} decay={2} />
      <Ribbon points={UPPER} width={0.42} twist={Math.PI * 1.6} material={gold} position={[0.6, 0.9, 0]} phase={0.2} />
      <Ribbon points={LOWER} width={0.3} twist={-Math.PI * 1.2} material={gold} position={[-0.4, -0.6, 0]} phase={1.7} />
      <Ribbon points={FAR} width={0.5} twist={Math.PI} material={shadowGold} position={[0, 0, -1]} phase={3.1} />
      <Particles count={24} color={colors.accent} size={0.05} opacity={0.5} speed={0.08} glow edges seed={5} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 10], fov: 35 }, environment: 0.9 };
export default scene;
