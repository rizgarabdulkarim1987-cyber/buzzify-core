'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, Color, MeshBasicMaterial, MeshPhysicalMaterial, type Group, type Mesh } from 'three';
import { approach, useSceneClock, usePaletteColors } from '../kit/clock';
import { Particles } from '../kit/particles';
import { pebbleGeometry } from '../kit/shapes';
import { shaftTexture } from '../kit/textures';
import type { SceneModule, SceneProps } from '../registry';

/**
 * 10 Ocean Pearl: under the sea. Shafts of light come down from the surface and sway; smooth glass forms and a pearl
 * hang in the water; bubbles rise. Scrolling takes the camera deeper and the light fades; a tap sends the glass forms
 * drifting away from it and a burst of bubbles up.
 */

const FORMS = [
  { x: 0.78, y: 0.42, z: -0.6, s: 0.62, seed: 3 },
  { x: -0.8, y: 0.1, z: -1.4, s: 0.5, seed: 7 },
  { x: 0.62, y: -0.66, z: 0.2, s: 0.4, seed: 12 },
  { x: -0.6, y: -0.8, z: -2.2, s: 0.7, seed: 21 },
];

function Scene({ palette, low }: SceneProps) {
  const colors = usePaletteColors(palette);
  const clock = useSceneClock();
  const viewport = useThree((state) => state.viewport);
  const forms = useRef<Array<Group | null>>([]);
  const shafts = useRef<Array<Mesh | null>>([]);
  const push = useRef(FORMS.map(() => ({ x: 0, y: 0 })));
  const geometries = useMemo(() => FORMS.map((form) => pebbleGeometry(form.seed, 0.8)), []);
  const glass = useMemo(
    () =>
      low
        ? new MeshPhysicalMaterial({ color: colors.accent, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, clearcoat: 1 })
        : new MeshPhysicalMaterial({ color: colors.accent.clone().lerp(new Color('#ffffff'), 0.5), roughness: 0.06, transmission: 0.92, thickness: 0.8, ior: 1.35 }),
    [colors.accent, low],
  );
  const pearl = useMemo(() => new MeshPhysicalMaterial({ color: colors.text, roughness: 0.18, iridescence: 1, iridescenceIOR: 1.6, clearcoat: 1 }), [colors.text]);
  const texture = useMemo(() => shaftTexture(), []);
  const light = useMemo(() => new MeshBasicMaterial({ map: texture, color: colors.accent.clone().lerp(new Color('#ffffff'), 0.6), transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }), [texture, colors.accent]);
  useEffect(
    () => () => {
      geometries.forEach((geometry) => geometry.dispose());
      glass.dispose();
      pearl.dispose();
      texture.dispose();
      light.dispose();
    },
    [geometries, glass, pearl, texture, light],
  );

  useFrame(({ camera }, delta) => {
    camera.position.y = approach(camera.position.y, -clock.progress * 2.5, 3, delta);
    // The shafts share one material, so setting it through the first sets them all.
    const lit = shafts.current[0]?.material as MeshBasicMaterial | undefined;
    if (lit) lit.opacity = 0.35 * (1 - clock.progress * 0.6) * (0.5 + clock.intensity * 0.5);
    shafts.current.forEach((shaft, i) => {
      if (shaft) shaft.rotation.z = -0.25 + i * 0.2 + Math.sin(clock.t * 0.25 + i) * 0.06;
    });
    FORMS.forEach((form, i) => {
      const group = forms.current[i];
      if (!group) return;
      const x = form.x * (viewport.width / 2);
      const y = form.y * (viewport.height / 2);
      const dx = x - clock.tap.x;
      const dy = y - clock.tap.y;
      const reach = Math.exp(-(dx * dx + dy * dy) / 3) * clock.tapPulse;
      const p = push.current[i]!;
      p.x = approach(p.x, dx * reach * 0.6, 2, delta);
      p.y = approach(p.y, dy * reach * 0.6, 2, delta);
      group.position.set(x + p.x, y + p.y + Math.sin(clock.t * 0.5 + i * 1.7) * 0.12, form.z);
      group.rotation.set(clock.t * 0.1 + i, clock.t * 0.13, 0);
    });
  });

  return (
    <>
      <ambientLight intensity={0.35} color={colors.accent} />
      <directionalLight position={[0, 8, 4]} intensity={2} color="#e8fbff" />
      {[-1.6, 0.2, 1.8].map((x, i) => (
        <mesh
          key={i}
          ref={(node) => {
            shafts.current[i] = node;
          }}
          material={light}
          position={[x, 2.4, -3]}
        >
          <planeGeometry args={[1.4, 9]} />
        </mesh>
      ))}
      {FORMS.map((form, i) => (
        <group
          key={i}
          ref={(node) => {
            forms.current[i] = node;
          }}
          scale={form.s}
        >
          <mesh geometry={geometries[i]} material={i === 2 ? pearl : glass} />
        </group>
      ))}
      <Particles count={28} color={colors.text} size={0.06} opacity={0.4} speed={0.3} edges seed={31} drift={0.12} />
    </>
  );
}

const scene: SceneModule = { Scene, camera: { position: [0, 0, 9], fov: 38 }, environment: 0.9 };
export default scene;
