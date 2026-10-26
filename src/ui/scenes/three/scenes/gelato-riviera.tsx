'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, Color, IcosahedronGeometry, MeshPhysicalMaterial, MeshStandardMaterial, type Group } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { speckleTexture, waffleTexture } from '../kit/textures';
import { WaterSurface } from '../kit/water';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 26 Gelato Riviera: a scoop of gelato in a waffle cone, turning above a sea that answers each tap with rings. The scoop
 * has the soft ridges of a spatula-shaped gelato; scrolling lowers the cone toward the water and back.
 */

function scoopGeometry(): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(1, 5);
  const position = geometry.attributes.position as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Spatula ridges round the scoop and a flat underside where it sits in the cone.
    const angle = Math.atan2(z, x);
    const ridge = 1 + Math.sin(angle * 5 + y * 3) * 0.05 + Math.sin(angle * 11 - y * 5) * 0.02;
    position.setXYZ(i, x * ridge, Math.max(y, -0.45) * 0.92, z * ridge);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function Scene({ palette }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const cone = useRef<Group>(null);
  const spin = useRef(0);
  const scoop = useMemo(() => scoopGeometry(), []);
  const speckle = useMemo(() => speckleTexture(4, 1400), []);
  const waffle = useMemo(() => waffleTexture('#D9A46A', '#B47A43'), []);
  const peach = useMemo(() => new MeshPhysicalMaterial({ color: colors.raised.clone().lerp(new Color('#EAB29A'), 0.6), roughness: 0.7, bumpMap: speckle, bumpScale: 0.6, sheen: 0.4, sheenColor: new Color('#fff1e6') }), [colors.raised, speckle]);
  const cream = useMemo(() => new MeshPhysicalMaterial({ color: colors.card, roughness: 0.75, bumpMap: speckle, bumpScale: 0.5 }), [colors.card, speckle]);
  const coneMaterial = useMemo(() => new MeshStandardMaterial({ map: waffle, roughness: 0.8 }), [waffle]);
  const deep = useMemo(() => colors.accent.clone().lerp(colors.bg, 0.2), [colors.accent, colors.bg]);
  const shallow = useMemo(() => colors.accent.clone().lerp(colors.bg, 0.75), [colors.accent, colors.bg]);
  const light = useMemo(() => new Color('#ffffff'), []);
  useEffect(
    () => () => {
      scoop.dispose();
      speckle.dispose();
      waffle.dispose();
      peach.dispose();
      cream.dispose();
      coneMaterial.dispose();
    },
    [scoop, speckle, waffle, peach, cream, coneMaterial],
  );

  useFrame((_, delta) => {
    spin.current = approach(spin.current, spin.current + clock.tapPulse * 0.5, 5, delta);
    if (cone.current) {
      cone.current.position.set((viewport.width / 2) * 0.6, (viewport.height / 2) * 0.3 - clock.progress * 1.4 + Math.sin(clock.t * 0.8) * 0.06, 0.6);
      cone.current.rotation.set(0.15, clock.t * 0.35 + spin.current, Math.sin(clock.t * 0.5) * 0.05);
    }
  });

  return (
    <>
      <hemisphereLight args={[colors.card, colors.accent, 1.1]} />
      <directionalLight position={[3, 6, 5]} intensity={1.8} color="#fff6ea" />
      <WaterSurface deep={deep} shallow={shallow} light={light} opacity={0.45} position={[0, -2.5, -2]} rotation={[-1.1, 0, 0]} />
      <group ref={cone} scale={0.62}>
        <mesh material={coneMaterial} position={[0, -1.25, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.72, 2.1, 48, 1, true]} />
        </mesh>
        <mesh geometry={scoop} material={peach} position={[0, 0.25, 0]} scale={0.82} />
        <mesh geometry={scoop} material={cream} position={[0.05, 1.08, 0.02]} scale={0.62} rotation={[0, 1, 0]} />
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 8], fov: 40 }, environment: 1 };
export default scene;
