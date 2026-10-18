'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, type Group } from 'three';
import { shadowTexture } from '@/ui/stage/materials';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { latheOf, PROFILES } from '../kit/shapes';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 18 Gallery Blanc: a white plinth in an empty white room with a single object on it, a porcelain cup with a band of
 * the brand's accent, turning slowly. A tap gives it a turn; scrolling walks round it. A stylized piece, not a
 * photograph of any product.
 */

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const plinth = useRef<Group>(null);
  const piece = useRef<Group>(null);
  const spin = useRef(0);
  const cup = useMemo(() => latheOf(PROFILES.cup), []);
  const porcelain = useMemo(() => new MeshPhysicalMaterial({ color: colors.card, roughness: 0.18, clearcoat: 1, side: DoubleSide }), [colors.card]);
  const band = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.3, clearcoat: 0.6 }), [colors.accent]);
  const block = useMemo(() => new MeshStandardMaterial({ color: colors.surface, roughness: 0.9 }), [colors.surface]);
  const shadow = useMemo(() => shadowTexture(), []);
  useEffect(
    () => () => {
      cup.dispose();
      porcelain.dispose();
      band.dispose();
      block.dispose();
      shadow.dispose();
    },
    [cup, porcelain, band, block, shadow],
  );

  useFrame(({ camera }, delta) => {
    spin.current = approach(spin.current, spin.current + clock.tapPulse * 0.8, 4, delta);
    plinth.current?.position.set((viewport.width / 2) * 0.55, -(viewport.height / 2) * 0.6, -1);
    if (piece.current) piece.current.rotation.y = clock.t * 0.25 + spin.current + clock.progress * Math.PI;
    camera.position.y = 0.8 + clock.progress * 0.8;
    camera.lookAt(0, 0, -1);
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.raised, 1.3]} />
      <directionalLight position={[3, 7, 5]} intensity={1.4} />
      <group ref={plinth}>
        <mesh material={block} position={[0, -1.1, 0]}>
          <boxGeometry args={[1.5, 2.2, 1.5]} />
        </mesh>
        <mesh position={[0, -2.19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3.6, 3.6]} />
          <meshBasicMaterial map={shadow} transparent opacity={0.25} depthWrite={false} />
        </mesh>
        <group ref={piece} scale={0.75}>
          <mesh geometry={cup} material={porcelain} />
          <mesh material={band} position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.69, 0.02, 12, 64]} />
          </mesh>
          <mesh material={porcelain} position={[0.82, 0.55, 0]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.2, 0.05, 12, 32]} />
          </mesh>
        </group>
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0.8, 8], fov: 40 }, environment: 1.1 };
export default scene;
