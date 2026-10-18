'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshBasicMaterial, MeshStandardMaterial, AdditiveBlending, type Group, type Mesh, type PointLight } from 'three';
import { softDotTexture } from '@/ui/stage/materials';
import { useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 07 Ember Grill: a cast-iron grill over glowing coals at the foot of the page. Embers drift up, few and slow. Scrolling
 * swings the camera over the grill, from a low view of the bars to looking down into the fire; a tap stirs the coals.
 */

const BARS = 11;

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const grill = useRef<Group>(null);
  const fire = useRef<PointLight>(null);
  const bed = useRef<Mesh>(null);
  const iron = useMemo(() => new MeshStandardMaterial({ color: new Color('#1b1a18'), metalness: 0.85, roughness: 0.45 }), []);
  const glowTexture = useMemo(() => softDotTexture(), []);
  const coals = useMemo(
    () => new MeshBasicMaterial({ map: glowTexture, color: colors.accent.clone().lerp(new Color('#ff8a3c'), 0.4), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
    [glowTexture, colors.accent],
  );
  useEffect(
    () => () => {
      iron.dispose();
      glowTexture.dispose();
      coals.dispose();
    },
    [iron, glowTexture, coals],
  );
  const ember = useMemo(() => colors.accent.clone().lerp(new Color('#ffb066'), 0.5), [colors.accent]);

  useFrame(() => {
    const p = clock.progress;
    if (grill.current) {
      grill.current.rotation.x = -0.45 - p * 0.8;
      grill.current.position.y = -2.5 + p * 0.8;
    }
    if (fire.current) {
      const flicker = Math.sin(clock.t * 7) * 0.4 + Math.sin(clock.t * 11.3) * 0.25;
      fire.current.intensity = 9 + flicker + clock.tapPulse * 10;
    }
    const glow = bed.current?.material as MeshBasicMaterial | undefined;
    if (glow) glow.opacity = 0.7 + Math.sin(clock.t * 3) * 0.08 + clock.tapPulse * 0.2;
  });

  return (
    <>
      <ambientLight intensity={0.12} />
      <pointLight ref={fire} position={[0, -1.9, 1]} color={ember} distance={9} decay={1.6} />
      <group ref={grill} position={[0, -2.5, 0]}>
        {Array.from({ length: BARS }, (_, i) => (
          <mesh key={i} material={iron} position={[(i - (BARS - 1) / 2) * 0.62, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 6, 12]} />
          </mesh>
        ))}
        <mesh material={iron} position={[0, 0, 2.9]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.09, 0.09, 7.2, 12]} />
        </mesh>
        <mesh material={iron} position={[0, 0, -2.9]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.09, 0.09, 7.2, 12]} />
        </mesh>
        <mesh ref={bed} material={coals} position={[0, -0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[9, 7]} />
        </mesh>
      </group>
      <Particles count={44} color={ember} size={0.12} opacity={1} speed={0.35} glow spread={[0.9, 0.9, 2]} drift={0.25} seed={21} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 10], fov: 35 }, environment: 0.35 };
export default scene;
