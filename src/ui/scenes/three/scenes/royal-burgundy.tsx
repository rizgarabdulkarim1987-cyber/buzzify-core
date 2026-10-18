'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, CatmullRomCurve3, MeshPhysicalMaterial, PlaneGeometry, TubeGeometry, Vector3, type DirectionalLight, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 04 Royal Burgundy: a sheet of velvet in soft folds with a gold thread across it. The folds breathe slowly; a change of
 * chapter (category) rolls a gentle wave through them; a tap presses the velvet where it lands; scrolling turns the
 * light across the pile.
 */

const SEGMENTS = 64;

function folds(x: number, y: number, t: number, wave: number): number {
  return (
    Math.sin(x * 1.1 + t * 0.35) * 0.35 +
    Math.sin(x * 2.3 - y * 0.6 + t * 0.22) * 0.14 +
    Math.sin(y * 0.8 + t * 0.18) * 0.12 +
    Math.sin(x * 0.7 - wave * 6) * wave * 0.4
  );
}

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const velvet = useRef<Mesh>(null);
  const press = useRef({ x: 0, y: 0, depth: 0 });
  const wave = useRef(0);
  const key = useRef<DirectionalLight>(null);
  const geometry = useMemo(() => new PlaneGeometry(16, 12, low ? 40 : SEGMENTS, low ? 30 : 48), [low]);
  const base = useMemo(() => Float32Array.from(geometry.attributes.position!.array as Float32Array), [geometry]);
  const material = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: colors.bg.clone().lerp(colors.accent, 0.08),
        roughness: 0.9,
        sheen: 1,
        sheenRoughness: 0.45,
        sheenColor: colors.text.clone().lerp(colors.accent, 0.4),
      }),
    [colors.bg, colors.accent, colors.text],
  );
  const thread = useMemo(
    () => new TubeGeometry(new CatmullRomCurve3([new Vector3(-8, -2.6, 0.6), new Vector3(-3, -1.4, 0.9), new Vector3(1.5, -2.4, 0.7), new Vector3(8, -1, 0.5)]), 120, 0.025, 8),
    [],
  );
  const gold = useMemo(() => new MeshPhysicalMaterial({ color: colors.accent, metalness: 1, roughness: 0.25 }), [colors.accent]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      thread.dispose();
      gold.dispose();
    },
    [geometry, material, thread, gold],
  );

  useFrame(({ camera }, delta) => {
    wave.current = approach(wave.current, clock.categoryPulse, 2, delta);
    if (clock.tapPulse > 0.95) press.current = { x: clock.tap.x, y: clock.tap.y, depth: 1 };
    press.current.depth = approach(press.current.depth, 0, 1.6, delta);
    const position = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = base[i * 3]!;
      const y = base[i * 3 + 1]!;
      const dx = x - press.current.x;
      const dy = y - press.current.y;
      const dip = -Math.exp(-(dx * dx + dy * dy) / 1.4) * press.current.depth * 0.5;
      position.setZ(i, folds(x, y, clock.t, wave.current) + dip);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    key.current?.position.set(-5 + clock.progress * 10, 4, 4);
    camera.position.x = Math.sin(clock.progress * Math.PI) * 1.2;
    camera.lookAt(0, 0, -2);
  });

  return (
    <>
      <ambientLight intensity={0.2} />
      <directionalLight ref={key} position={[-5, 4, 4]} intensity={1.8} color={colors.text} />
      <directionalLight position={[6, -2, 3]} intensity={0.5} color={colors.accent} />
      <group rotation={[-0.35, 0, 0.08]} position={[0, -0.6, -3]}>
        <mesh ref={velvet} geometry={geometry} material={material} />
        <mesh geometry={thread} material={gold} />
      </group>
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 10], fov: 35 }, environment: 0.6 };
export default scene;
